/**
 * Pure Validator Core Functions
 *
 * Store-free validation logic extracted from validators.ts.
 * Each function takes pre-parsed artifacts directly (no store or threadId).
 *
 * These are consumed by:
 *   1. validators.ts — store-aware wrappers that fetch from store, then delegate here
 *   2. artifact-editor-graph revalidate node — passes artifacts from graph state directly
 *
 * Convention: every function is synchronous and returns string[] (error messages).
 */

import { InstructionsPlanningResponseSchema } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-instructions/schema.js";
import {
  InstructionsArtifact,
  InstructionsArtifactSchema,
  TransitionsArtifact,
} from "#chaincraft/ai/simulate/schema.js";
import {
  extractSchemaFields,
  isValidFieldReference,
  extractFieldReferences,
  classifyInvalidFieldReference,
  getComputedContextFieldNames,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/schema-utils.js";
import { TransitionGraph } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/transition-graph.js";
import { StateDeltaOpSchema } from "#chaincraft/ai/simulate/logic/statedelta.js";
import {
  collectCurrentActionWrites,
  collectCurrentActionReads,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/generate-mechanics/currentaction-scanner.js";

// ─── Helper Functions (private) ───

/**
 * Validate that path segments don't mix literals with template variables
 */
function validatePathSegmentStructure(
  path: string,
  context: string,
  errors: string[],
): void {
  const segments = path.split(".");

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment) continue;

    const templateMatches = segment.match(/\{\{[^}]+\}\}/g);
    if (!templateMatches || templateMatches.length === 0) continue;

    if (templateMatches.length === 1) {
      const isFullTemplate = segment === templateMatches[0];
      if (isFullTemplate) {
        // {{playerId}} is the ONLY supported path template variable.
        // It is resolved to the acting player's UUID at runtime (player action phases only).
        // Any other template — {{winnerId}}, {{game.X}}, {{input.X}} etc. — is NOT resolved
        // and will be written as a literal key into state, creating phantom players/fields.
        if (segment !== '{{playerId}}') {
          errors.push(
            `${context}: Path segment "${segment}" uses an unsupported template variable. ` +
            `Only {{playerId}} is a valid path template — it resolves to the acting player's UUID ` +
            `in player action stateDelta ops. No other template variables are resolved in paths. ` +
            `To target all players use setForAllPlayers/setForRandomPlayer. ` +
            `To target a specific player use a literal alias (e.g. 'player1'). ` +
            `For any computation based on state values, use mechanicsGuidance instead of stateDelta.`,
          );
        }
        continue;
      }
    }

    errors.push(
      `${context}: Path segment "${segment}" mixes literal text with template variables. ` +
        `Each segment must be EITHER a literal value OR a complete template variable. ` +
        `Use dot notation for template variables, NEVER brackets. ` +
        `Invalid: "scoreP{{id}}", "players[{{playerId}}]". ` +
        `Valid: "score", "players.{{playerId}}.currentAction"`,
    );
  }
}

/**
 * Detect JS expressions inside template variables.
 * Template variables must be simple dot-path lookups only — not JS expressions.
 * Examples of INVALID templates: {{score > 0 ? score : 0}}, {{Math.abs(x)}}, {{a == 'UP' && b > 0}}
 */
const TEMPLATE_EXPRESSION_RE = /\{\{[^}]*(==|!=|&&|\|\||\?|Math\.|=>|>=|<=)[^}]*\}\}/;

function validateNoTemplateExpressions(
  value: string,
  fieldDescription: string,
  context: string,
  errors: string[],
): void {
  if (typeof value !== "string") return;
  if (!value.includes("{{")) return;
  if (TEMPLATE_EXPRESSION_RE.test(value)) {
    errors.push(
      `${context}: ${fieldDescription} contains a JS expression inside \`{{}}\`: "${value}". ` +
      `Template variables must be simple state path lookups only (e.g. {{players.player1.score}}). ` +
      `For conditional logic, scoring, or arithmetic, use mechanicsGuidance so the runtime LLM computes it.`,
    );
  }
}

/**
 * Validate stateDelta operations for correctness
 */
function validateStateDelta(
  stateDelta: any[],
  context: string,
  errors: string[],
  warnings: string[],
  schemaFields?: Set<string>,
  validDataSourceIds?: Set<string>,
): void {
  const validOps = StateDeltaOpSchema.options.map((s) => s.shape.op._def.value as string);

  for (let i = 0; i < stateDelta.length; i++) {
    const op = stateDelta[i];

    if (!op.op) {
      errors.push(`${context}: stateDelta[${i}] missing 'op' field`);
      continue;
    }

    if (!validOps.includes(op.op)) {
      errors.push(
        `${context}: stateDelta[${i}] has invalid op '${op.op}'. Valid ops: ${validOps.join(", ")}`,
      );
      continue;
    }

    switch (op.op) {
      case "set":
      case "increment":
      case "append":
      case "merge":
        if (!op.path) {
          errors.push(
            `${context}: stateDelta[${i}] op '${op.op}' missing 'path' field`,
          );
        }
        if (op.value === undefined) {
          errors.push(
            `${context}: stateDelta[${i}] op '${op.op}' missing 'value' field`,
          );
        }
        break;

      case "setForAllPlayers":
        if (!op.field) {
          errors.push(
            `${context}: stateDelta[${i}] op 'setForAllPlayers' missing 'field' field`,
          );
        }
        if (op.value === undefined) {
          errors.push(
            `${context}: stateDelta[${i}] op 'setForAllPlayers' missing 'value' field`,
          );
        }
        break;

      case "delete":
        if (!op.path) {
          errors.push(
            `${context}: stateDelta[${i}] op 'delete' missing 'path' field`,
          );
        }
        break;

      case "transfer":
        if (!op.fromPath) {
          errors.push(
            `${context}: stateDelta[${i}] op 'transfer' missing 'fromPath' field`,
          );
        }
        if (!op.toPath) {
          errors.push(
            `${context}: stateDelta[${i}] op 'transfer' missing 'toPath' field`,
          );
        }
        if (op.amount === undefined) {
          errors.push(
            `${context}: stateDelta[${i}] op 'transfer' missing 'amount' field`,
          );
        }
        break;

      case "rng":
        if (!op.path) {
          errors.push(
            `${context}: stateDelta[${i}] op 'rng' missing 'path' field`,
          );
        }
        if (
          !op.choices ||
          !Array.isArray(op.choices) ||
          op.choices.length === 0
        ) {
          errors.push(
            `${context}: stateDelta[${i}] op 'rng' missing or invalid 'choices' array`,
          );
        }
        if (!op.probabilities || !Array.isArray(op.probabilities)) {
          errors.push(
            `${context}: stateDelta[${i}] op 'rng' missing or invalid 'probabilities' array`,
          );
        } else if (
          op.choices &&
          op.probabilities.length !== op.choices.length
        ) {
          errors.push(
            `${context}: stateDelta[${i}] op 'rng' probabilities length (${op.probabilities.length}) must match choices length (${op.choices.length})`,
          );
        } else {
          const sum = op.probabilities.reduce(
            (acc: number, p: number) => acc + p,
            0,
          );
          if (Math.abs(sum - 1.0) > 0.01) {
            warnings.push(
              `${context}: stateDelta[${i}] op 'rng' probabilities sum to ${sum}, not 1.0`,
            );
          }
        }
        break;

      case "setFromMap":
        if (!op.keyPath) {
          errors.push(
            `${context}: stateDelta[${i}] op 'setFromMap' missing 'keyPath' field`,
          );
        }
        if (!op.path) {
          errors.push(
            `${context}: stateDelta[${i}] op 'setFromMap' missing 'path' field`,
          );
        }
        if (!op.map || typeof op.map !== "object" || Array.isArray(op.map)) {
          errors.push(
            `${context}: stateDelta[${i}] op 'setFromMap' missing or invalid 'map' field (must be a key-value object)`,
          );
        } else if (Object.keys(op.map).length === 0) {
          errors.push(
            `${context}: stateDelta[${i}] op 'setFromMap' has empty 'map' object`,
          );
        }
        break;

      case "setFromDataSource":
        if (!op.path) {
          errors.push(
            `${context}: stateDelta[${i}] op 'setFromDataSource' missing 'path' field`,
          );
        }
        if (!op.dataSourceId) {
          errors.push(
            `${context}: stateDelta[${i}] op 'setFromDataSource' missing 'dataSourceId' field`,
          );
        } else if (
          validDataSourceIds &&
          !validDataSourceIds.has(op.dataSourceId) &&
          !/\{\{.+\}\}/.test(op.dataSourceId)  // template variable — resolved at runtime, skip static check
        ) {
          errors.push(
            `${context}: stateDelta[${i}] op 'setFromDataSource' references unknown dataSourceId '${op.dataSourceId}'. ` +
              `Valid IDs: ${[...validDataSourceIds].join(", ")}`,
          );
        }
        if (op.paramValues && typeof op.paramValues !== "object") {
          errors.push(
            `${context}: stateDelta[${i}] op 'setFromDataSource' paramValues must be an object`,
          );
        }
        break;
    }

    // Validate that template variables are path lookups, not JS expressions
    const stringFieldsToCheckForExpressions: [any, string][] = [
      [op.path, "path"],
      [(op as any).keyPath, "keyPath"],
      [(op as any).fromPath, "fromPath"],
      [(op as any).toPath, "toPath"],
      [(op as any).dataSourceId, "dataSourceId"],
      [typeof op.value === "string" ? op.value : null, "value"],
    ];
    for (const [fieldVal, fieldName] of stringFieldsToCheckForExpressions) {
      if (fieldVal) {
        validateNoTemplateExpressions(fieldVal, `stateDelta[${i}].${fieldName}`, context, errors);
      }
    }

    // Validate that array values don't contain template variables
    if (
      (op.op === "set" || op.op === "append" || op.op === "setForAllPlayers") &&
      op.value !== undefined
    ) {
      if (Array.isArray(op.value)) {
        const hasTemplates = JSON.stringify(op.value).includes("{{");
        if (hasTemplates) {
          errors.push(
            `${context}: stateDelta[${i}] op '${op.op}' has array value containing template variables. ` +
              `Template variables in arrays are not expanded. Use bracket notation to set array elements individually.`,
          );
        }
      }
    }

    // Validate field references if schema provided
    if (schemaFields) {
      const pathField = op.path || op.fromPath || op.toPath;
      if (pathField && typeof pathField === "string") {
        let cleanPath = pathField
          .replace(/\[\{\{[^}]+\}\}\]/g, "[*]")
          .replace(/\.?\{\{[^}]+\}\}\.?/g, "[*].")
          .replace(/\.\[/g, "[")
          .replace(/\.\./g, ".")
          .replace(/\.\s*$/, "");

        if (!cleanPath.includes("{{") && cleanPath !== "[*]") {
          if (!isValidFieldReference(cleanPath, schemaFields)) {
            const classification = classifyInvalidFieldReference(cleanPath, schemaFields);
            if (classification === 'unscoped') {
              const computedFields = getComputedContextFieldNames();
              warnings.push(
                `${context}: stateDelta[${i}] references unscoped field: '${pathField}'. ` +
                `State field references must use their full path (e.g., 'game.${pathField}' or 'players.${pathField}'). ` +
                `Only computed context fields can be referenced without a prefix: ${computedFields.join(', ')}.`,
              );
            } else {
              warnings.push(
                `${context}: stateDelta[${i}] references unknown field: ${pathField}`,
              );
            }
          }
        }
      }
    }
  }
}

/**
 * Normalize a path by replacing template variables with wildcards for comparison.
 */
export function normalizePath(path: string): string {
  let normalized = path.replace(/\{\{[^}]+\}\}/g, "[*]");
  normalized = normalized.replace(/\[(\*|\d+)\]/g, ".[*]");
  normalized = normalized.replace(/\.\.+/g, ".");
  return normalized;
}

/**
 * Extract normalized field paths written by a single stateDelta operation.
 */
export function getWrittenFieldsFromOp(op: any): string[] {
  if (!op) return [];
  if ((op.op === "setForAllPlayers" || op.op === "setForRandomPlayer") && op.field) {
    return [normalizePath(`players[*].${op.field}`)];
  }
  if (op.op === "transfer") {
    const fields: string[] = [];
    if (op.fromPath) fields.push(normalizePath(op.fromPath));
    if (op.toPath) fields.push(normalizePath(op.toPath));
    return fields;
  }
  if (op.path && typeof op.path === "string") {
    return [normalizePath(op.path)];
  }
  return [];
}

// ─── Core Validator Functions ───

/**
 * Core: Validate planner output for completeness.
 * @param plannerOutput - Raw planner output string
 */
export function validatePlanCompletenessCore(plannerOutput: string): string[] {
  const errors: string[] = [];

  if (!plannerOutput || typeof plannerOutput !== "string") {
    return ["Planner output is missing or invalid"];
  }

  try {
    let jsonStr = plannerOutput.trim();
    if (jsonStr.startsWith("```json")) {
      jsonStr = jsonStr.substring(7);
    } else if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.substring(3);
    }
    if (jsonStr.endsWith("```")) {
      jsonStr = jsonStr.substring(0, jsonStr.length - 3);
    }
    jsonStr = jsonStr.trim();

    const parsedJson = JSON.parse(jsonStr);
    const hints = InstructionsPlanningResponseSchema.parse(parsedJson);

    if (!hints.playerPhases && !hints.transitions) {
      errors.push("No instructions provided by planner");
    }

    if (
      hints.playerPhases &&
      hints.playerPhases.length === 0 &&
      hints.transitions &&
      hints.transitions.length === 0
    ) {
      errors.push(
        "Planner provided empty arrays for both playerPhases and transitions",
      );
    }

    for (const phaseInst of hints.playerPhases || []) {
      if (phaseInst.playerActions.length === 0) {
        console.warn(
          `[instructions][planner-validation] Player phase '${phaseInst.phase}' has no player actions`,
        );
      }
    }

    for (const transition of hints.transitions || []) {
      if (transition.requiresLLMReasoning && !transition.mechanicsDescription) {
        console.warn(
          `[instructions][planner-validation] Transition '${transition.id}' requires LLM reasoning but has no mechanics description`,
        );
      }
    }
  } catch (error) {
    errors.push(`Planner output parsing/validation failed: ${error}`);
  }

  return errors;
}

/**
 * Core: Validate executor output is parseable JSON and matches InstructionsArtifact schema.
 * @param artifact - The parsed artifact (already fetched and parsed)
 */
export function validateJsonParseableCore(
  artifact: InstructionsArtifact,
): string[] {
  const errors: string[] = [];
  try {
    InstructionsArtifactSchema.parse(artifact);
  } catch (error) {
    errors.push(`Execution output is not valid InstructionsArtifact: ${error}`);
  }
  return errors;
}

/**
 * Core: Validate path structure in all stateDelta operations.
 */
export function validatePathStructureCore(
  artifact: InstructionsArtifact,
): string[] {
  const errors: string[] = [];

  // Validate player phases
  for (const [phaseName, phaseInst] of Object.entries(
    artifact.playerPhases || {},
  )) {
    for (const action of phaseInst.playerActions || []) {
      if (action.stateDelta && Array.isArray(action.stateDelta)) {
        for (let i = 0; i < action.stateDelta.length; i++) {
          const op = action.stateDelta[i] as any;
          const pathField = op.path || op.fromPath || op.toPath;
          if (pathField && typeof pathField === "string") {
            validatePathSegmentStructure(
              pathField,
              `Action '${action.id}' stateDelta[${i}]`,
              errors,
            );
          }
        }
      }
    }
  }

  // Validate transitions
  for (const [transitionId, transition] of Object.entries(
    artifact.transitions || {},
  )) {
    if (transition.stateDelta && Array.isArray(transition.stateDelta)) {
      for (let i = 0; i < transition.stateDelta.length; i++) {
        const op = transition.stateDelta[i] as any;
        const pathField = op.path || op.fromPath || op.toPath;
        if (pathField && typeof pathField === "string") {
          validatePathSegmentStructure(
            pathField,
            `Transition '${transition.id}' stateDelta[${i}]`,
            errors,
          );
        }
      }
    }
  }

  return errors;
}

/**
 * Core: Validate precondition coverage — all fields used in preconditions
 * must be written by some stateDelta op or generated mechanic.
 *
 * @param mechanicWrittenFields - Optional set of dot-paths written by generated mechanics
 *   (from scanWrittenFields). When provided, these supplement stateDelta coverage.
 */
export function validatePreconditionsCanPassCore(
  artifact: InstructionsArtifact,
  transitions: TransitionsArtifact,
  mechanicWrittenFields?: Set<string>,
): string[] {
  const errors: string[] = [];
  const transitionList = transitions.transitions || [];

  // Collect all fields referenced in preconditions
  const preconditionFields = new Set<string>();
  transitionList.forEach((t: any) => {
    if (!t.preconditions || !Array.isArray(t.preconditions)) return;
    t.preconditions.forEach((p: any) => {
      if (!p.logic) return;
      const fields = extractFieldReferences(p.logic);
      fields.forEach((f: string) => {
        const baseField = f.endsWith(".length") ? f.slice(0, -7) : f;
        preconditionFields.add(baseField);
      });
    });
  });

  if (preconditionFields.size === 0) return [];

  // Fields managed by the runtime — exempt from "must have a stateDelta writer" checks.
  // Router-computed context fields are derived directly from RouterContextSchema so this
  // set stays in sync automatically when new fields are added to the schema.
  const RUNTIME_MANAGED_FIELDS = new Set([
    ...getComputedContextFieldNames(),
    "game.currentPhase",
    "game.gameEnded",
  ]);

  // Collect all fields written by any stateDelta or generated mechanic
  const writtenFields = new Set<string>();

  const addPath = (path: string) => {
    if (!path || typeof path !== "string") return;
    writtenFields.add(path);
    const normalizedPath = path
      .replace(/\.\{\{[^}]+\}\}\./g, "[*].")
      .replace(/\.player\d+\./g, "[*].")
      .replace(/players\.\*/g, "players[*]")
      .replace(/\[\d+\]/g, "");
    writtenFields.add(normalizedPath);
  };

  // Transition stateDelta ops
  if (artifact.transitions) {
    Object.values(artifact.transitions).forEach((t: any) => {
      (t?.stateDelta || []).forEach((op: any) => {
        addPath(op.path);
        addPath(op.fromPath);
        addPath(op.toPath);
        if (op.field && (op.op === "setForAllPlayers" || op.op === "setForRandomPlayer")) {
          addPath(`players[*].${op.field}`);
        }
      });
    });
  }

  // Player action stateDelta ops
  Object.values(artifact.playerPhases || {}).forEach((phase: any) => {
    (phase?.playerActions || []).forEach((action: any) => {
      (action?.stateDelta || []).forEach((op: any) => {
        addPath(op.path);
        addPath(op.fromPath);
        addPath(op.toPath);
        if (op.field && (op.op === "setForAllPlayers" || op.op === "setForRandomPlayer")) {
          addPath(`players[*].${op.field}`);
        }
      });
    });
  });

  // Merge in written fields from generated mechanics (after addPath is defined)
  if (mechanicWrittenFields) {
    mechanicWrittenFields.forEach((path) => addPath(path));
  }

  // Check coverage
  const missingFields: string[] = [];
  preconditionFields.forEach((field: string) => {
    if (RUNTIME_MANAGED_FIELDS.has(field)) return;
    if (writtenFields.has(field)) return;
    const normalizedField = field
      .replace(/\[\d+\]/g, "")
      .replace(/\.\d+\./g, ".");
    if (writtenFields.has(normalizedField)) return;
    // A write to any ancestor path covers this field — e.g. writing "game.matchScore"
    // covers "game.matchScore.p1" because the whole object is replaced at once.
    const parts = normalizedField.split(".");
    const hasAncestorWrite = parts.slice(1).some((_, i) => {
      const ancestorPath = parts.slice(0, i + 2).join(".");
      return writtenFields.has(ancestorPath);
    });
    if (hasAncestorWrite) return;
    missingFields.push(field);
  });

  missingFields.forEach((field: string) => {
    errors.push(
      `Field "${field}" is used in transition preconditions but is never written by any stateDelta operation or generated mechanic.`,
    );
  });

  return errors;
}

/**
 * Core: Validate that player action stateDelta only writes to player.currentAction
 * only, never to game state fields or other player fields.
 */
export function validatePlayerActionWritesCurrentActionCore(
  artifact: InstructionsArtifact,
): string[] {
  const errors: string[] = [];

  // Paths that player action stateDelta is allowed to write
  const ALLOWED_PLAYER_FIELDS = ['currentAction'];

  for (const [phaseName, phaseInst] of Object.entries(artifact.playerPhases || {})) {
    for (const action of phaseInst.playerActions || []) {
      for (const op of action.stateDelta || []) {
        const path: string = (op as any).path || '';

        // setForAllPlayers is not allowed from player actions at all —
        // actionRequired/actionsAllowed are set by mechanics, not players
        if (op.op === 'setForAllPlayers') {
          errors.push(
            `Player action '${action.id}' in phase '${phaseName}': ` +
            `setForAllPlayers is not allowed in player action stateDelta. ` +
            `Player actions may only write to 'players.{{playerId}}.currentAction'. ` +
            `actionRequired and actionsAllowed are set by mechanics.`
          );
          continue;
        }

        // Skip ops without a path (rng, etc.)
        if (!path) continue;

        // Reject writes to game.* fields
        if (path.startsWith('game.') || path === 'game') {
          errors.push(
            `Player action '${action.id}' in phase '${phaseName}': ` +
            `stateDelta writes to '${path}' which is a game-level field. ` +
            `Player actions MUST only write to 'players.{{playerId}}.currentAction'. ` +
            `Game outcome fields and actionRequired are written by automatic transition mechanics.`
          );
          continue;
        }

        // For player-scoped paths, only currentAction and actionRequired are allowed
        if (path.includes('players.') || path.includes('player')) {
          const segments = path.split('.');
          // Find the field name (last meaningful segment, after playerId)
          // e.g. "players.{{playerId}}.currentAction" → field = "currentAction"
          // e.g. "players.{{playerId}}.score" → field = "score"
          const playerIdx = segments.findIndex(s => s === 'players' || s.startsWith('player'));
          if (playerIdx >= 0 && segments.length > playerIdx + 2) {
            const fieldName = segments[playerIdx + 2];
            if (fieldName && !fieldName.startsWith('{{') && !ALLOWED_PLAYER_FIELDS.includes(fieldName)) {
              errors.push(
                `Player action '${action.id}' in phase '${phaseName}': ` +
                `stateDelta writes to '${path}' (field '${fieldName}'). ` +
                `Player actions may only write to 'currentAction'. ` +
                `actionRequired and actionsAllowed are set by mechanics, not player actions.`
              );
            }
          }

          // Reject parent-path currentAction assignment: path ends at currentAction with no sub-field
          // (e.g. "players.{{playerId}}.currentAction" with value {type: ..., count: ...}).
          // This pattern makes it impossible for collectCurrentActionWrites to detect which
          // sub-fields are written, breaking the coherence validator.
          // Each field must be a separate sub-field op: "players.{{playerId}}.currentAction.<field>".
          if (
            op.op === 'set' &&
            /^players\.[^.]+\.currentAction$/.test(path)
          ) {
            const value = (op as any).value;
            if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
              errors.push(
                `Player action '${action.id}' in phase '${phaseName}': ` +
                `stateDelta uses a parent-path assignment to '${path}' with an object value. ` +
                `This is FORBIDDEN — each field must be a separate op with path ` +
                `'players.{{playerId}}.currentAction.<fieldName>' (e.g. ` +
                `{ "op": "set", "path": "players.{{playerId}}.currentAction.count", "value": "{{input.count}}" }). ` +
                `Parent-path object assignment prevents the coherence validator from detecting which sub-fields are written.`
              );
            }
          }
        }
      }
    }
  }

  return errors;
}

/**
 * Core: Validate that every player action stateDelta includes a 'set' op that writes
 * 'currentAction.type' (i.e. a path ending in '.currentAction.type').
 * A missing write is an invalid artifact — the runtime verifier will reject it, so
 * we catch it here at generation time rather than silently patching it at runtime.
 */
export function validatePlayerActionSetsActionTypeCore(
  artifact: InstructionsArtifact,
): string[] {
  const errors: string[] = [];

  for (const [phaseName, phaseInst] of Object.entries(artifact.playerPhases || {})) {
    for (const action of phaseInst.playerActions || []) {
      const ops: any[] = action.stateDelta || [];
      const typeOp = ops.find(
        (op) =>
          op.op === 'set' &&
          typeof op.path === 'string' &&
          op.path.endsWith('.currentAction.type'),
      );
      if (!typeOp) {
        errors.push(
          `Player action '${action.id}' in phase '${phaseName}': ` +
          `stateDelta must include a 'set' op that writes 'players.{{playerId}}.currentAction.type'. ` +
          `The runtime identifies which action was taken from this field — omitting it is an invalid artifact.`,
        );
      } else if (typeOp.value !== action.id) {
        errors.push(
          `Player action '${action.id}' in phase '${phaseName}': ` +
          `the 'currentAction.type' value must equal the action's own id. ` +
          `Found value '${typeOp.value}' but expected '${action.id}'. ` +
          `The runtime looks up validation rules by matching currentAction.type against playerAction ids — a mismatch causes every player action to be rejected at runtime.`,
        );
      }
    }
  }

  return errors;
}

/**
 * Core: Validate narrative markers exist in specNarratives.
 * @param artifact - The instructions artifact
 * @param specNarratives - Map of available narrative markers
 */
export function validateNarrativeMarkersCore(
  artifact: InstructionsArtifact,
  specNarratives: Record<string, string>,
): string[] {
  const errors: string[] = [];

  const narrativeMarkerPattern = /!___ NARRATIVE:(\w+) ___!/g;
  const availableMarkers = new Set(Object.keys(specNarratives || {}));
  const referencedMarkers = new Set<string>();

  const artifactStr = JSON.stringify(artifact);
  let match;
  while ((match = narrativeMarkerPattern.exec(artifactStr)) !== null) {
    referencedMarkers.add(match[1]);
  }

  for (const marker of referencedMarkers) {
    if (!availableMarkers.has(marker)) {
      errors.push(
        `Narrative marker '${marker}' referenced but not found in specNarratives. ` +
          `Available markers: ${Array.from(availableMarkers).join(", ") || "none"}`,
      );
    }
  }

  return errors;
}

/**
 * Core: Validate artifact structure and stateDelta operations.
 * @param artifact - The instructions artifact
 * @param stateSchema - The parsed state schema (array or JSON Schema object)
 */
export function validateArtifactStructureCore(
  artifact: InstructionsArtifact,
  stateSchema?: any,
  validDataSourceIds?: Set<string>,
): string[] {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Extract schema fields
  let schemaFields: Set<string> | undefined;
  if (stateSchema) {
    schemaFields = extractSchemaFields(stateSchema);
    // Add runtime-injected player fields that are always present on every player
    // regardless of the game schema. Without these, stateDelta ops referencing them
    // produce false-positive "unknown field" warnings that would corrupt the repair agent.
    // The sub-path check in isValidFieldReference means players.currentAction.* sub-paths
    // (e.g. currentAction.weapon, currentAction.type) are covered by players.currentAction.
    for (const runtimeField of [
      "players.currentAction",
      "players.actionRequired",
      "players.illegalActionCount",
      "players.privateMessage",
      "players.isGameWinner",
    ]) {
      schemaFields.add(runtimeField);
    }
  }

  // Check coverage
  if (!artifact.playerPhases && !artifact.transitions) {
    errors.push("No instructions in artifact");
  }

  const playerPhaseCount = Object.keys(artifact.playerPhases || {}).length;
  const transitionCount = Object.keys(artifact.transitions || {}).length;

  if (playerPhaseCount === 0 && transitionCount === 0) {
    errors.push("Artifact has empty playerPhases and transitions");
  }

  // Validate player phases
  for (const [phaseName, phaseInst] of Object.entries(
    artifact.playerPhases || {},
  )) {
    for (const action of phaseInst.playerActions || []) {
      if (action.validation) {
        if (
          !action.validation.checks ||
          action.validation.checks.length === 0
        ) {
          warnings.push(
            `Action '${action.id}' has validation config but no checks array`,
          );
        }

        for (const check of action.validation.checks || []) {
          if (!check.id) {
            errors.push(
              `Action '${action.id}' has validation check without id`,
            );
          }
          if (!check.errorMessage) {
            errors.push(
              `Action '${action.id}' validation check '${check.id}' has no errorMessage`,
            );
          }
        }
      }

      if (!action.stateDelta || action.stateDelta.length === 0) {
        warnings.push(`Action '${action.id}' has no stateDelta operations`);
      } else {
        validateStateDelta(
          action.stateDelta,
          `Action '${action.id}'`,
          errors,
          warnings,
          schemaFields,
          validDataSourceIds,
        );
      }
    }
  }

  // Validate transitions
  for (const [transitionId, transition] of Object.entries(
    artifact.transitions || {},
  )) {
    if (!transition.stateDelta || transition.stateDelta.length === 0) {
      warnings.push(
        `Transition '${transition.id}' has no stateDelta operations`,
      );
    } else {
      validateStateDelta(
        transition.stateDelta,
        `Transition '${transition.id}'`,
        errors,
        warnings,
        schemaFields,
        validDataSourceIds,
      );
    }

    if (transition.mechanicsGuidance) {
      // mechanicsGuidance can be a string or { rules, computation } object
      if (typeof transition.mechanicsGuidance === 'object') {
        if (
          !transition.mechanicsGuidance.rules ||
          transition.mechanicsGuidance.rules.length === 0
        ) {
          warnings.push(
            `Transition '${transition.id}' has mechanicsGuidance object but no rules array`,
          );
        }
      }
      // String form is always valid — no further checks needed
    }
  }

  if (warnings.length > 0) {
    console.warn(
      "[instructions][artifact-validation] Validation warnings:",
      warnings,
    );
  }

  return errors;
}

/**
 * Core: Validate field coverage — fields in preconditions set by at least one stateDelta.
 * Returns warnings (empty array — warnings logged but don't block).
 */
export function validateFieldCoverageCore(
  artifact: InstructionsArtifact,
  transitions: TransitionsArtifact,
): string[] {
  if (!transitions.transitions || !Array.isArray(transitions.transitions))
    return [];

  // Collect all fields SET by any instruction's stateDelta
  const fieldsSet = new Set<string>();

  const addFieldFromOp = (op: any) => {
    if (op.op === "set" && op.path) {
      fieldsSet.add(normalizePath(op.path));
    } else if (op.op === "setForAllPlayers" && op.field) {
      fieldsSet.add(`players[*].${op.field}`);
    } else if (op.op === "increment" && op.path) {
      fieldsSet.add(normalizePath(op.path));
    } else if (op.op === "append" && op.path) {
      fieldsSet.add(normalizePath(op.path));
    } else if (op.op === "merge" && op.path) {
      fieldsSet.add(normalizePath(op.path));
    } else if (op.op === "delete" && op.path) {
      fieldsSet.add(normalizePath(op.path));
    } else if (op.op === "transfer") {
      if (op.fromPath) fieldsSet.add(normalizePath(op.fromPath));
      if (op.toPath) fieldsSet.add(normalizePath(op.toPath));
    } else if (op.op === "rng" && op.path) {
      fieldsSet.add(normalizePath(op.path));
    }
  };

  // Scan transition instructions
  if (artifact.transitions) {
    for (const [, instruction] of Object.entries(artifact.transitions)) {
      if (instruction.stateDelta && Array.isArray(instruction.stateDelta)) {
        instruction.stateDelta.forEach(addFieldFromOp);
      }
    }
  }

  // Scan player phase instructions
  if (artifact.playerPhases) {
    for (const [, instruction] of Object.entries(artifact.playerPhases)) {
      if (typeof instruction === "string") continue;
      if (
        instruction.playerActions &&
        Array.isArray(instruction.playerActions)
      ) {
        for (const action of instruction.playerActions) {
          if (action.stateDelta && Array.isArray(action.stateDelta)) {
            action.stateDelta.forEach(addFieldFromOp);
          }
        }
      }
    }
  }

  // Check all fields READ by transitions (from checkedFields)
  const fieldsRead = new Set<string>();
  const fieldUsage = new Map<string, string[]>();

  for (const transition of transitions.transitions) {
    if (!transition.checkedFields || !Array.isArray(transition.checkedFields))
      continue;
    for (const field of transition.checkedFields) {
      fieldsRead.add(field);
      if (!fieldUsage.has(field)) fieldUsage.set(field, []);
      fieldUsage.get(field)!.push(transition.id);
    }
  }

  // Fields managed by the runtime — exempt from deadlock field-coverage checks.
  // Mirrors the same set used in validateFieldCoverage.
  const RUNTIME_MANAGED_FIELDS = new Set([
    ...getComputedContextFieldNames(),
    "game.currentPhase",
    "game.gameEnded",
  ]);

  // Find fields read but never set
  const uninitializedFields: string[] = [];
  for (const field of fieldsRead) {
    if (RUNTIME_MANAGED_FIELDS.has(field)) continue;
    const normalizedField = normalizePath(field);
    if (!fieldsSet.has(field) && !fieldsSet.has(normalizedField)) {
      uninitializedFields.push(field);
    }
  }

  if (uninitializedFields.length > 0) {
    console.warn("[extract_instructions][validation] Field coverage warnings:");
    for (const field of uninitializedFields) {
      const usedBy = fieldUsage.get(field) || [];
      const warning =
        `Field '${field}' is used in transition preconditions (${usedBy.join(", ")}) ` +
        `but is never set by any stateDelta operation. This may cause transitions to never fire. ` +
        `Consider adding a stateDelta operation to initialize this field.`;
      console.warn(`  ⚠️  ${warning}`);
    }
  }

  // Return empty — warnings are logged but don't block validation (matches original behavior)
  return [];
}

/**
 * Core: Validate no transition is self-blocking.
 */
export function validateSelfBlockingTransitionsCore(
  artifact: InstructionsArtifact,
  transitions: TransitionsArtifact,
): string[] {
  const errors: string[] = [];

  if (!transitions.transitions || !Array.isArray(transitions.transitions))
    return [];

  // Build map: normalizedField -> Set<transitionId>
  const fieldWrittenBy = new Map<string, Set<string>>();
  for (const [transitionId, instruction] of Object.entries(
    artifact.transitions || {},
  )) {
    for (const op of instruction.stateDelta || []) {
      for (const field of getWrittenFieldsFromOp(op)) {
        if (!fieldWrittenBy.has(field)) fieldWrittenBy.set(field, new Set());
        fieldWrittenBy.get(field)!.add(transitionId);
      }
    }
  }

  // For each transition, find checkedFields only written by that same transition
  for (const transition of transitions.transitions) {
    if (!transition.checkedFields || transition.checkedFields.length === 0)
      continue;
    if (!transition.preconditions || transition.preconditions.length === 0)
      continue;

    const instruction = (artifact.transitions || ({} as any))[transition.id];
    if (!instruction?.stateDelta || instruction.stateDelta.length === 0)
      continue;

    const writtenByThis = new Set<string>();
    for (const op of instruction.stateDelta) {
      for (const field of getWrittenFieldsFromOp(op)) {
        writtenByThis.add(field);
      }
    }
    if (writtenByThis.size === 0) continue;

    for (const checkedField of transition.checkedFields) {
      const normalized = normalizePath(checkedField);
      if (!writtenByThis.has(normalized)) continue;

      const allWriters = fieldWrittenBy.get(normalized) ?? new Set();
      const otherWriters = [...allWriters].filter((id) => id !== transition.id);

      if (otherWriters.length === 0) {
        errors.push(
          `Transition '${transition.id}' is self-blocking: field '${checkedField}' is checked ` +
            `by a precondition but is only ever set by this transition's own stateDelta. ` +
            `The transition can never fire because the precondition can never be satisfied before it runs. ` +
            `Fix: move the stateDelta op that sets '${checkedField}' to the predecessor transition ` +
            `that fires immediately before '${transition.id}' (i.e., the transition that targets phase '${transition.fromPhase}').`,
        );
      } else {
        console.warn(
          `[extract_instructions][validation] Transition '${transition.id}' both checks and sets ` +
            `field '${checkedField}'. Other transitions also set this field: [${otherWriters.join(", ")}]. ` +
            `Verify one of those always fires before '${transition.id}'.`,
        );
      }
    }
  }

  return errors;
}

/**
 * Core: Validate that initial state created by init transition doesn't create a deadlock.
 */
export function validateInitialStatePreconditionsCore(
  artifact: InstructionsArtifact,
  transitions: TransitionsArtifact,
): string[] {
  const errors: string[] = [];

  if (!transitions.transitions || !Array.isArray(transitions.transitions))
    return [];

  // Find init transition
  const initTransition = transitions.transitions.find(
    (t: any) => t.fromPhase === "init",
  );
  if (!initTransition) return [];

  const startingPhase = initTransition.toPhase;
  if (!startingPhase) {
    return ["Init transition has no toPhase"];
  }

  // Get init instructions
  const initInstructions = (artifact.transitions || ({} as any))[
    initTransition.id
  ];
  if (!initInstructions) return [];


  // Find all transitions from the starting phase
  const startingTransitions = transitions.transitions.filter(
    (t: any) => t.fromPhase === startingPhase,
  );

  if (startingTransitions.length === 0) {
    errors.push(
      `Init transition moves to phase "${startingPhase}" but there are no transitions from that phase. ` +
        `This creates an immediate deadlock.`,
    );
    return errors;
  }

  // Static check 2: if the starting phase requires player input, the init stateDelta must
  // set actionRequired=true for at least one player. A player-input phase with no player
  // flagged as active is an immediate deadlock — no state simulation needed to detect this.
  const phaseMetadata = transitions.phaseMetadata?.find(
    (pm: any) => pm.phase === startingPhase,
  );
  const requiresPlayerInput = phaseMetadata?.requiresPlayerInput ?? false;

  if (requiresPlayerInput) {
    const stateDelta: any[] = initInstructions.stateDelta ?? [];

    const setsActionRequiredTrue = stateDelta.some((op: any) => {
      // setForAllPlayers { field: "actionRequired", value: true }
      if (op.op === "setForAllPlayers" && op.field === "actionRequired" && op.value === true) return true;
      // setForRandomPlayer { field: "actionRequired", value: true }
      if (op.op === "setForRandomPlayer" && op.field === "actionRequired" && op.value === true) return true;
      // set players.<alias-or-template>.actionRequired = true
      if (op.op === "set" && op.value === true && typeof op.path === "string") {
        if (/^players\.[^.]+\.actionRequired$/.test(op.path)) return true;
      }
      // setFromMap where path ends in .actionRequired and at least one mapped value is true
      if (op.op === "setFromMap" && typeof op.path === "string" && op.path.endsWith(".actionRequired")) {
        if (op.map && typeof op.map === "object") {
          if (Object.values(op.map).some((v: any) => v === true)) return true;
        }
      }
      // merge targeting a player root (players.<id>) with actionRequired: true in the value
      if (op.op === "merge" && typeof op.path === "string" && op.value && typeof op.value === "object") {
        if (/^players\.[^.]+$/.test(op.path) && op.value.actionRequired === true) return true;
      }
      return false;
    });

    if (!setsActionRequiredTrue) {
      errors.push(
        `Init transition moves to phase "${startingPhase}" which requires player input, ` +
          `but the init stateDelta never sets actionRequired=true for any player. ` +
          `At least one player must have actionRequired=true after initialization or the game will deadlock immediately. ` +
          `Fix: add a setForRandomPlayer op (e.g. { op: "setForRandomPlayer", field: "actionRequired", value: true }) ` +
          `or a setFromMap op that maps to actionRequired=true for the starting player.`,
      );
    }
  }

  return errors;
}

/**
 * Core: Validate that game can properly end with winners declared.
 * Uses TransitionGraph directly instead of getOrBuildGraph (no threadId needed for caching).
 */
export function validateGameCompletionCore(
  artifact: InstructionsArtifact,
  transitions: TransitionsArtifact,
): string[] {
  const errors: string[] = [];

  try {
    const graph = new TransitionGraph(transitions, artifact);

    // Check 1: At least one path to "finished" exists (gameEnded is set automatically by the router)
    const terminalPaths = graph.getTerminalPaths();
    if (terminalPaths.length === 0) {
      errors.push(
        'No paths from init to "finished" phase found. The router sets game.gameEnded=true automatically when transitioning to "finished", but no such path exists.',
      );
    }

    // Check 2: At least one transition must set isGameWinner
    // NOTE: Disabled — isGameWinner is now set by generated mechanic code, not static stateDelta.
    // Re-enable when mechanic code validation is in place.
    // const isGameWinnerSetters = graph.findFieldSetters(
    //   "players.*.isGameWinner",
    // );
    // if (isGameWinnerSetters.length === 0) {
    //   errors.push(
    //     "No transition sets players.*.isGameWinner. At least one transition must mark winning players. " +
    //       "Set isGameWinner=true for each winning player before or when the game ends. " +
    //       "Runtime will automatically compute game.winningPlayers from these flags.",
    //   );
    // }

    // Check 3: All terminal paths set isGameWinner somewhere along the path
    // NOTE: Disabled — same reason as Check 2.
    // if (terminalPaths.length > 0) {
    //   let hasWinningPath = false;
    //   for (const path of terminalPaths) {
    //     if (graph.pathSetsField(path, "players.*.isGameWinner")) {
    //       hasWinningPath = true;
    //       break;
    //     }
    //   }
    //   if (!hasWinningPath) {
    //     errors.push(
    //       'No path to "finished" sets players.*.isGameWinner. ' +
    //         "If your game has winners, at least one ending path must set isGameWinner=true for winning players. " +
    //         "If this is a draw-only game (no winners), you can ignore this warning.",
    //     );
    //   }
    // }
  } catch (error) {
    errors.push(
      `Error validating game completion: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return errors;
}

/**
 * Core: Validate phase connectivity and structural soundness.
 * Uses TransitionGraph directly — does NOT need instructions artifact.
 */
export function validatePhaseConnectivityCore(
  transitions: TransitionsArtifact,
  artifact?: InstructionsArtifact,
): string[] {
  const errors: string[] = [];

  try {
    const graph = new TransitionGraph(transitions, artifact);

    const allPhases = new Set(transitions.phases);
    const terminalPhase = graph.getTerminalPhase();

    if (!allPhases.has(terminalPhase)) {
      errors.push(
        `Terminal phase '${terminalPhase}' not found in phases array. ` +
          `This is required by convention.`,
      );
      return errors;
    }

    // Check all defined phases are reachable from init
    const reachablePhases = graph.getReachablePhasesFromInit();
    for (const phase of allPhases) {
      if (!reachablePhases.has(phase)) {
        errors.push(
          `Phase '${phase}' is unreachable from init phase. ` +
            `This phase will never execute and should be removed or connected to the game flow.`,
        );
      }
    }

    // Check terminal phase is reachable
    if (!reachablePhases.has(terminalPhase)) {
      errors.push(
        `Terminal phase '${terminalPhase}' is unreachable from init. ` +
          `Game cannot properly end because the terminal phase cannot be reached.`,
      );
    }
  } catch (error) {
    errors.push(
      `Error validating phase connectivity: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return errors;
}

/**
 * Cross-artifact coherence check: currentAction shape.
 *
 * Compares the set of currentAction sub-fields written by player-action stateDelta ops
 * (instructions artifact) with the set of currentAction sub-fields read by generated
 * mechanic code (TS AST scan). Any field read by a mechanic that was never written by
 * any player action is flagged as an error — it will always be undefined at runtime.
 *
 * Requires both artifacts to be present; returns [] if either is missing/empty.
 */
export function validateCurrentActionCoherenceCore(
  artifact: InstructionsArtifact,
  generatedMechanics: Record<string, string>,
): string[] {
  const errors: string[] = [];

  if (
    !artifact ||
    Object.keys(generatedMechanics).length === 0
  ) {
    return errors;
  }

  const writtenFields = collectCurrentActionWrites(artifact);

  for (const [mechanicId, code] of Object.entries(generatedMechanics)) {
    const readFields = collectCurrentActionReads(code);
    for (const field of readFields) {
      if (!writtenFields.has(field)) {
        errors.push(
          `Mechanic '${mechanicId}' reads currentAction.${field} but no player action ` +
          `stateDelta writes players.<player>.currentAction.${field}. ` +
          `Written currentAction fields: [${[...writtenFields].join(', ')}]. ` +
          `Either add an op to the player action stateDelta or fix the mechanic to use a written field.`,
        );
      }
    }
  }

  return errors;
}
