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

import {
  InstructionsPlanningResponseSchema,
} from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-instructions/schema.js';
import {
  InstructionsArtifact,
  InstructionsArtifactSchema,
  TransitionsArtifact,
} from '#chaincraft/ai/simulate/schema.js';
import {
  extractSchemaFields,
  isValidFieldReference,
  extractFieldReferences,
} from '#chaincraft/ai/simulate/graphs/spec-processing-graph/schema-utils.js';
import { TransitionGraph } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/transition-graph.js';

// ─── Helper Functions (private) ───

/**
 * Validate that path segments don't mix literals with template variables
 */
function validatePathSegmentStructure(
  path: string,
  context: string,
  errors: string[],
): void {
  const segments = path.split('.');

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment) continue;

    const templateMatches = segment.match(/\{\{[^}]+\}\}/g);
    if (!templateMatches || templateMatches.length === 0) continue;

    if (templateMatches.length === 1) {
      const isFullTemplate = segment === templateMatches[0];
      if (isFullTemplate) continue;
    }

    errors.push(
      `${context}: Path segment "${segment}" mixes literal text with template variables. ` +
      `Each segment must be EITHER a literal value OR a complete template variable. ` +
      `Use dot notation for template variables, NEVER brackets. ` +
      `Invalid: "scoreP{{id}}", "players[{{winnerId}}]". ` +
      `Valid: "score", "{{fieldName}}", "players.{{winnerId}}.isGameWinner"`,
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
): void {
  const validOps = ['set', 'increment', 'append', 'delete', 'transfer', 'merge', 'rng', 'setForAllPlayers'];

  for (let i = 0; i < stateDelta.length; i++) {
    const op = stateDelta[i];

    if (!op.op) {
      errors.push(`${context}: stateDelta[${i}] missing 'op' field`);
      continue;
    }

    if (!validOps.includes(op.op)) {
      errors.push(`${context}: stateDelta[${i}] has invalid op '${op.op}'. Valid ops: ${validOps.join(', ')}`);
      continue;
    }

    switch (op.op) {
      case 'set':
      case 'increment':
      case 'append':
      case 'merge':
        if (!op.path) {
          errors.push(`${context}: stateDelta[${i}] op '${op.op}' missing 'path' field`);
        }
        if (op.value === undefined) {
          errors.push(`${context}: stateDelta[${i}] op '${op.op}' missing 'value' field`);
        }
        break;

      case 'setForAllPlayers':
        if (!op.field) {
          errors.push(`${context}: stateDelta[${i}] op 'setForAllPlayers' missing 'field' field`);
        }
        if (op.value === undefined) {
          errors.push(`${context}: stateDelta[${i}] op 'setForAllPlayers' missing 'value' field`);
        }
        break;

      case 'delete':
        if (!op.path) {
          errors.push(`${context}: stateDelta[${i}] op 'delete' missing 'path' field`);
        }
        break;

      case 'transfer':
        if (!op.fromPath) {
          errors.push(`${context}: stateDelta[${i}] op 'transfer' missing 'fromPath' field`);
        }
        if (!op.toPath) {
          errors.push(`${context}: stateDelta[${i}] op 'transfer' missing 'toPath' field`);
        }
        if (op.amount === undefined) {
          errors.push(`${context}: stateDelta[${i}] op 'transfer' missing 'amount' field`);
        }
        break;

      case 'rng':
        if (!op.path) {
          errors.push(`${context}: stateDelta[${i}] op 'rng' missing 'path' field`);
        }
        if (!op.choices || !Array.isArray(op.choices) || op.choices.length === 0) {
          errors.push(`${context}: stateDelta[${i}] op 'rng' missing or invalid 'choices' array`);
        }
        if (!op.probabilities || !Array.isArray(op.probabilities)) {
          errors.push(`${context}: stateDelta[${i}] op 'rng' missing or invalid 'probabilities' array`);
        } else if (op.choices && op.probabilities.length !== op.choices.length) {
          errors.push(`${context}: stateDelta[${i}] op 'rng' probabilities length (${op.probabilities.length}) must match choices length (${op.choices.length})`);
        } else {
          const sum = op.probabilities.reduce((acc: number, p: number) => acc + p, 0);
          if (Math.abs(sum - 1.0) > 0.01) {
            warnings.push(`${context}: stateDelta[${i}] op 'rng' probabilities sum to ${sum}, not 1.0`);
          }
        }
        break;
    }

    // Validate that array values don't contain template variables
    if ((op.op === 'set' || op.op === 'append' || op.op === 'setForAllPlayers') && op.value !== undefined) {
      if (Array.isArray(op.value)) {
        const hasTemplates = JSON.stringify(op.value).includes('{{');
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
      if (pathField && typeof pathField === 'string') {
        let cleanPath = pathField
          .replace(/\[\{\{[^}]+\}\}\]/g, '[*]')
          .replace(/\.?\{\{[^}]+\}\}\.?/g, '[*].')
          .replace(/\.\[/g, '[')
          .replace(/\.\./g, '.')
          .replace(/\.\s*$/, '');

        if (!cleanPath.includes('{{') && cleanPath !== '[*]') {
          if (!isValidFieldReference(cleanPath, schemaFields)) {
            warnings.push(
              `${context}: stateDelta[${i}] references unknown field: ${pathField}`,
            );
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
  let normalized = path.replace(/\{\{[^}]+\}\}/g, '[*]');
  normalized = normalized.replace(/\[(\*|\d+)\]/g, '.[*]');
  normalized = normalized.replace(/\.\.+/g, '.');
  return normalized;
}

/**
 * Extract normalized field paths written by a single stateDelta operation.
 */
export function getWrittenFieldsFromOp(op: any): string[] {
  if (!op) return [];
  if (op.op === 'setForAllPlayers' && op.field) {
    return [normalizePath(`players[*].${op.field}`)];
  }
  if (op.op === 'transfer') {
    const fields: string[] = [];
    if (op.fromPath) fields.push(normalizePath(op.fromPath));
    if (op.toPath) fields.push(normalizePath(op.toPath));
    return fields;
  }
  if (op.path && typeof op.path === 'string') {
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

  if (!plannerOutput || typeof plannerOutput !== 'string') {
    return ['Planner output is missing or invalid'];
  }

  try {
    let jsonStr = plannerOutput.trim();
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.substring(7);
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.substring(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.substring(0, jsonStr.length - 3);
    }
    jsonStr = jsonStr.trim();

    const parsedJson = JSON.parse(jsonStr);
    const hints = InstructionsPlanningResponseSchema.parse(parsedJson);

    if (!hints.playerPhases && !hints.transitions) {
      errors.push('No instructions provided by planner');
    }

    if (hints.playerPhases && hints.playerPhases.length === 0 && hints.transitions && hints.transitions.length === 0) {
      errors.push('Planner provided empty arrays for both playerPhases and transitions');
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
export function validateJsonParseableCore(artifact: InstructionsArtifact): string[] {
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
export function validatePathStructureCore(artifact: InstructionsArtifact): string[] {
  const errors: string[] = [];

  // Validate player phases
  for (const [phaseName, phaseInst] of Object.entries(artifact.playerPhases || {})) {
    for (const action of phaseInst.playerActions || []) {
      if (action.stateDelta && Array.isArray(action.stateDelta)) {
        for (let i = 0; i < action.stateDelta.length; i++) {
          const op = action.stateDelta[i] as any;
          const pathField = op.path || op.fromPath || op.toPath;
          if (pathField && typeof pathField === 'string') {
            validatePathSegmentStructure(pathField, `Action '${action.id}' stateDelta[${i}]`, errors);
          }
        }
      }
    }
  }

  // Validate transitions
  for (const [transitionId, transition] of Object.entries(artifact.transitions || {})) {
    if (transition.stateDelta && Array.isArray(transition.stateDelta)) {
      for (let i = 0; i < transition.stateDelta.length; i++) {
        const op = transition.stateDelta[i] as any;
        const pathField = op.path || op.fromPath || op.toPath;
        if (pathField && typeof pathField === 'string') {
          validatePathSegmentStructure(pathField, `Transition '${transition.id}' stateDelta[${i}]`, errors);
        }
      }
    }
  }

  return errors;
}

/**
 * Core: Validate precondition coverage — all fields used in preconditions
 * must be written by some stateDelta op.
 */
export function validatePreconditionsCanPassCore(
  artifact: InstructionsArtifact,
  transitions: TransitionsArtifact,
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
        const baseField = f.endsWith('.length') ? f.slice(0, -7) : f;
        preconditionFields.add(baseField);
      });
    });
  });

  if (preconditionFields.size === 0) return [];

  // Router context fields computed at runtime
  const ROUTER_CONTEXT_FIELDS = new Set([
    'allPlayersCompletedActions',
    'playersCount',
    'playerCount',
    'allPlayersReady',
    'anyPlayerReady',
  ]);

  // Collect all fields written by any stateDelta
  const writtenFields = new Set<string>();

  const addPath = (path: string) => {
    if (!path || typeof path !== 'string') return;
    writtenFields.add(path);
    const normalizedPath = path
      .replace(/\.\{\{[^}]+\}\}\./g, '[*].')
      .replace(/\.player\d+\./g, '[*].')
      .replace(/players\.\*/g, 'players[*]')
      .replace(/\[\d+\]/g, '');
    writtenFields.add(normalizedPath);
  };

  // Transition stateDelta ops
  if (artifact.transitions) {
    Object.values(artifact.transitions).forEach((t: any) => {
      (t?.stateDelta || []).forEach((op: any) => {
        addPath(op.path);
        addPath(op.fromPath);
        addPath(op.toPath);
        if (op.field && op.op === 'setForAllPlayers') {
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
        if (op.field && op.op === 'setForAllPlayers') {
          addPath(`players[*].${op.field}`);
        }
      });
    });
  });

  // Check coverage
  const missingFields: string[] = [];
  preconditionFields.forEach((field: string) => {
    if (ROUTER_CONTEXT_FIELDS.has(field)) return;
    if (writtenFields.has(field)) return;
    const normalizedField = field.replace(/\[\d+\]/g, '').replace(/\.\d+\./g, '.');
    if (writtenFields.has(normalizedField)) return;
    missingFields.push(field);
  });

  missingFields.forEach((field: string) => {
    errors.push(
      `Field "${field}" is used in transition preconditions but is never written by any stateDelta operation.`,
    );
  });

  return errors;
}

/**
 * Core: Validate actionRequired is set in player actions.
 */
export function validateActionRequiredSetCore(artifact: InstructionsArtifact): string[] {
  const errors: string[] = [];

  for (const [phaseName, phaseInst] of Object.entries(artifact.playerPhases || {})) {
    for (const action of phaseInst.playerActions || []) {
      if (!action.stateDelta || action.stateDelta.length === 0) {
        continue;
      }

      const hasActionRequiredOp = action.stateDelta.some((op: any) => {
        if (op.path && typeof op.path === 'string') {
          return op.path.includes('.actionRequired') || op.path.endsWith('actionRequired');
        }
        if (op.op === 'setForAllPlayers' && op.field === 'actionRequired') {
          return true;
        }
        return false;
      });

      if (!hasActionRequiredOp) {
        errors.push(
          `Player action '${action.id}' must include a stateDelta operation that sets ` +
          `'players.{{playerId}}.actionRequired' to true or false. This ensures the router ` +
          `knows whether the player has completed their required actions for this phase.`,
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
        `Available markers: ${Array.from(availableMarkers).join(', ') || 'none'}`,
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
): string[] {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Extract schema fields
  let schemaFields: Set<string> | undefined;
  if (stateSchema) {
    schemaFields = extractSchemaFields(stateSchema);
  }

  // Check coverage
  if (!artifact.playerPhases && !artifact.transitions) {
    errors.push('No instructions in artifact');
  }

  const playerPhaseCount = Object.keys(artifact.playerPhases || {}).length;
  const transitionCount = Object.keys(artifact.transitions || {}).length;

  if (playerPhaseCount === 0 && transitionCount === 0) {
    errors.push('Artifact has empty playerPhases and transitions');
  }

  // Validate player phases
  for (const [phaseName, phaseInst] of Object.entries(artifact.playerPhases || {})) {
    for (const action of phaseInst.playerActions || []) {
      if (action.validation) {
        if (!action.validation.checks || action.validation.checks.length === 0) {
          warnings.push(`Action '${action.id}' has validation config but no checks array`);
        }

        for (const check of action.validation.checks || []) {
          if (!check.id) {
            errors.push(`Action '${action.id}' has validation check without id`);
          }
          if (!check.errorMessage) {
            errors.push(`Action '${action.id}' validation check '${check.id}' has no errorMessage`);
          }
        }
      }

      if (!action.stateDelta || action.stateDelta.length === 0) {
        warnings.push(`Action '${action.id}' has no stateDelta operations`);
      } else {
        validateStateDelta(action.stateDelta, `Action '${action.id}'`, errors, warnings, schemaFields);
      }
    }
  }

  // Validate transitions
  for (const [transitionId, transition] of Object.entries(artifact.transitions || {})) {
    if (!transition.stateDelta || transition.stateDelta.length === 0) {
      warnings.push(`Transition '${transition.id}' has no stateDelta operations`);
    } else {
      validateStateDelta(transition.stateDelta, `Transition '${transition.id}'`, errors, warnings, schemaFields);
    }

    if (transition.mechanicsGuidance) {
      if (!transition.mechanicsGuidance.rules || transition.mechanicsGuidance.rules.length === 0) {
        warnings.push(`Transition '${transition.id}' has mechanicsGuidance but no rules array`);
      }
    }
  }

  if (warnings.length > 0) {
    console.warn('[instructions][artifact-validation] Validation warnings:', warnings);
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
  if (!transitions.transitions || !Array.isArray(transitions.transitions)) return [];

  // Collect all fields SET by any instruction's stateDelta
  const fieldsSet = new Set<string>();

  const addFieldFromOp = (op: any) => {
    if (op.op === 'set' && op.path) {
      fieldsSet.add(normalizePath(op.path));
    } else if (op.op === 'setForAllPlayers' && op.field) {
      fieldsSet.add(`players[*].${op.field}`);
    } else if (op.op === 'increment' && op.path) {
      fieldsSet.add(normalizePath(op.path));
    } else if (op.op === 'append' && op.path) {
      fieldsSet.add(normalizePath(op.path));
    } else if (op.op === 'merge' && op.path) {
      fieldsSet.add(normalizePath(op.path));
    } else if (op.op === 'delete' && op.path) {
      fieldsSet.add(normalizePath(op.path));
    } else if (op.op === 'transfer') {
      if (op.fromPath) fieldsSet.add(normalizePath(op.fromPath));
      if (op.toPath) fieldsSet.add(normalizePath(op.toPath));
    } else if (op.op === 'rng' && op.path) {
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
      if (typeof instruction === 'string') continue;
      if (instruction.playerActions && Array.isArray(instruction.playerActions)) {
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
    if (!transition.checkedFields || !Array.isArray(transition.checkedFields)) continue;
    for (const field of transition.checkedFields) {
      fieldsRead.add(field);
      if (!fieldUsage.has(field)) fieldUsage.set(field, []);
      fieldUsage.get(field)!.push(transition.id);
    }
  }

  // Find fields read but never set
  const uninitializedFields: string[] = [];
  for (const field of fieldsRead) {
    const normalizedField = normalizePath(field);
    if (!fieldsSet.has(field) && !fieldsSet.has(normalizedField)) {
      uninitializedFields.push(field);
    }
  }

  if (uninitializedFields.length > 0) {
    console.warn('[extract_instructions][validation] Field coverage warnings:');
    for (const field of uninitializedFields) {
      const usedBy = fieldUsage.get(field) || [];
      const warning = `Field '${field}' is used in transition preconditions (${usedBy.join(', ')}) ` +
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

  if (!transitions.transitions || !Array.isArray(transitions.transitions)) return [];

  // Build map: normalizedField -> Set<transitionId>
  const fieldWrittenBy = new Map<string, Set<string>>();
  for (const [transitionId, instruction] of Object.entries(artifact.transitions || {})) {
    for (const op of instruction.stateDelta || []) {
      for (const field of getWrittenFieldsFromOp(op)) {
        if (!fieldWrittenBy.has(field)) fieldWrittenBy.set(field, new Set());
        fieldWrittenBy.get(field)!.add(transitionId);
      }
    }
  }

  // For each transition, find checkedFields only written by that same transition
  for (const transition of transitions.transitions) {
    if (!transition.checkedFields || transition.checkedFields.length === 0) continue;
    if (!transition.preconditions || transition.preconditions.length === 0) continue;

    const instruction = (artifact.transitions || {} as any)[transition.id];
    if (!instruction?.stateDelta || instruction.stateDelta.length === 0) continue;

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
      const otherWriters = [...allWriters].filter(id => id !== transition.id);

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
          `field '${checkedField}'. Other transitions also set this field: [${otherWriters.join(', ')}]. ` +
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

  if (!transitions.transitions || !Array.isArray(transitions.transitions)) return [];

  // Find init transition
  const initTransition = transitions.transitions.find((t: any) => t.fromPhase === 'init');
  if (!initTransition) return [];

  const startingPhase = initTransition.toPhase;
  if (!startingPhase) {
    return ['Init transition has no toPhase'];
  }

  // Get init instructions
  const initInstructions = (artifact.transitions || {} as any)[initTransition.id];
  if (!initInstructions) return [];

  // Build mock initial state by applying init's stateDelta.
  // This simulates what the state will look like after init runs,
  // so we can check if the starting phase will deadlock.
  //
  // Limitations handled:
  // - Template variables ({{game.activePlayer}}) can't be resolved statically,
  //   so we use optimistic application: if a set targets players.{{...}}.field,
  //   apply it to the first mock player (proving at least one player will have that value).
  // - setForAllPlayers ops have 'field' not 'path', so need special handling.
  // - RNG ops: use choices[0] as a stand-in value.
  const mockState: any = { game: {}, players: {} };

  // Helper: ensure mock players exist (player1 & player2 as defaults for 2-player games)
  const ensureMockPlayers = () => {
    if (Object.keys(mockState.players).length === 0) {
      mockState.players.player1 = {};
      mockState.players.player2 = {};
    }
  };

  // Helper: set a value at a dot-notation path in an object, creating intermediates
  const setAtPath = (obj: any, path: string, value: any) => {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const arrayMatch = part.match(/^(.+)\[(\d+)\]$/);
      if (arrayMatch) {
        const arrayName = arrayMatch[1];
        const index = parseInt(arrayMatch[2], 10);
        if (!current[arrayName]) current[arrayName] = [];
        if (!current[arrayName][index]) current[arrayName][index] = {};
        current = current[arrayName][index];
      } else {
        if (!current[part] || typeof current[part] !== 'object') current[part] = {};
        current = current[part];
      }
    }
    const lastPart = parts[parts.length - 1];
    const arrayMatch = lastPart.match(/^(.+)\[(\d+)\]$/);
    if (arrayMatch) {
      const arrayName = arrayMatch[1];
      const index = parseInt(arrayMatch[2], 10);
      if (!current[arrayName]) current[arrayName] = [];
      current[arrayName][index] = value;
    } else {
      current[lastPart] = value;
    }
  };

  if (initInstructions.stateDelta && Array.isArray(initInstructions.stateDelta)) {
    initInstructions.stateDelta.forEach((op: any) => {

      // Handle setForAllPlayers (has 'field' not 'path')
      if (op.op === 'setForAllPlayers' && op.field) {
        ensureMockPlayers();
        for (const playerId of Object.keys(mockState.players)) {
          mockState.players[playerId][op.field] = op.value;
        }
        return;
      }

      if (!op.path || typeof op.path !== 'string') return;

      // Check if path contains template variables (e.g., {{game.activePlayer}})
      const hasTemplate = /\{\{[^}]+\}\}/.test(op.path);

      // Handle RNG
      if (op.op === 'rng') {
        if (hasTemplate) return; // Can't resolve template in RNG path
        const parts = op.path.split('.');
        let current = mockState;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!current[parts[i]]) current[parts[i]] = {};
          current = current[parts[i]];
        }
        const lastPart = parts[parts.length - 1];
        if (op.choices && Array.isArray(op.choices) && op.choices.length > 0) {
          current[lastPart] = op.choices[0];
        } else {
          current[lastPart] = null;
        }
        return;
      }

      // Handle set operations
      if (op.op === 'set') {
        if (hasTemplate) {
          // Template path — try to resolve optimistically for player fields.
          // Pattern: players.{{someVar}}.fieldName = value
          // If we can extract the field name, apply it to the first mock player.
          // This proves at least one player will have this value at runtime.
          const templatePlayerMatch = op.path.match(
            /^players\.\{\{[^}]+\}\}\.(.+)$/
          );
          if (templatePlayerMatch) {
            const field = templatePlayerMatch[1];
            ensureMockPlayers();
            const firstPlayer = Object.keys(mockState.players)[0];
            if (firstPlayer) {
              setAtPath(mockState.players[firstPlayer], field, op.value);
            }
          }
          // For non-player template paths (e.g., game.{{...}}), skip — can't resolve
          return;
        }

        setAtPath(mockState, op.path, op.value);
      }
    });
  }

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

  // Check if any transition's preconditions can be satisfied
  const canFireTransitions = startingTransitions.filter((t: any) => {
    if (!t.preconditions || !Array.isArray(t.preconditions)) return true;

    const blockingConditions = t.preconditions.filter((p: any) => {
      if (!p.logic) return false;

      if (p.logic.allPlayers && Array.isArray(p.logic.allPlayers) && p.logic.allPlayers.length === 3) {
        const [field, op, expectedValue] = p.logic.allPlayers;
        if (typeof expectedValue === 'boolean' && (op === '==' || op === '===')) {
          const players = Object.values(mockState.players || {});
          if (players.length > 0) {
            const allMatch = players.every((player: any) => player[field] === expectedValue);
            if (!allMatch) return true;
          }
        }
      }

      if (p.logic.anyPlayer && Array.isArray(p.logic.anyPlayer) && p.logic.anyPlayer.length === 3) {
        const [field, op, expectedValue] = p.logic.anyPlayer;
        if (typeof expectedValue === 'boolean' && (op === '==' || op === '===')) {
          const players = Object.values(mockState.players || {});
          if (players.length > 0) {
            const anyMatch = players.some((player: any) => player[field] === expectedValue);
            if (!anyMatch) return true;
          }
        }
      }

      return false;
    });

    return blockingConditions.length === 0;
  });

  // Check deadlock conditions
  const phaseMetadata = transitions.phaseMetadata?.find((pm: any) => pm.phase === startingPhase);
  const requiresPlayerInput = phaseMetadata?.requiresPlayerInput ?? false;

  const players = Object.values(mockState.players || {});
  const anyPlayerCanAct = players.some((player: any) => !!player.actionRequired);

  const isDeadlock = canFireTransitions.length === 0 && (!requiresPlayerInput || !anyPlayerCanAct);

  if (isDeadlock) {
    console.error('[extract_instructions][validation] Deadlock detected in initial state!');
    console.error(`[extract_instructions][validation] Starting phase: ${startingPhase}, requiresPlayerInput: ${requiresPlayerInput}, anyPlayerCanAct: ${anyPlayerCanAct}`);
    console.error('[extract_instructions][validation] Mock state:', JSON.stringify(mockState, null, 2));

    if (!requiresPlayerInput) {
      errors.push(
        `Init transition creates immediate deadlock. After initialization, game moves to phase "${startingPhase}" ` +
        `but none of the ${startingTransitions.length} transition(s) from that phase can fire. ` +
        `Phase does NOT require player input, so at least one automatic transition must be able to fire. ` +
        `Common issue: init sets boolean fields to values that block all automatic transitions. ` +
        `Review init transition stateDelta and starting transitions' preconditions to ensure compatibility.`,
      );
    } else {
      errors.push(
        `Init transition creates immediate deadlock. After initialization, game moves to phase "${startingPhase}" ` +
        `but none of the ${startingTransitions.length} transition(s) from that phase can fire AND no players can act. ` +
        `Phase requires player input but all players have actionRequired=false, preventing any player actions. ` +
        `No transitions can fire and no players can act, creating a permanent deadlock. ` +
        `Fix: Either set actionRequired=true for players OR ensure at least one transition can fire immediately.`,
      );
    }

    // Add details about each transition's blocking conditions
    startingTransitions.forEach((t: any) => {
      if (!t.preconditions || t.preconditions.length === 0) return;

      const issues: string[] = [];
      t.preconditions.forEach((p: any) => {
        if (p.logic?.allPlayers && Array.isArray(p.logic.allPlayers) && p.logic.allPlayers.length === 3) {
          const [field, op, expectedValue] = p.logic.allPlayers;
          if (typeof expectedValue === 'boolean') {
            const playerList = Object.values(mockState.players || {});
            if (playerList.length > 0) {
              const actualValues = playerList.map((player: any) => player[field]);
              const allMatch = playerList.every((player: any) => player[field] === expectedValue);
              if (!allMatch) {
                issues.push(
                  `Precondition "${p.id}" requires all players have ${field}=${expectedValue}, ` +
                  `but init sets it to ${JSON.stringify(actualValues)}`,
                );
              }
            }
          }
        }
      });

      if (issues.length > 0) {
        errors.push(`  Transition "${t.id}" (${t.fromPhase} → ${t.toPhase}): ${issues.join('; ')}`);
      }
    });
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

    // Check 1: At least one transition must set gameEnded
    const gameEndedSetters = graph.findFieldSetters('game.gameEnded');
    if (gameEndedSetters.length === 0) {
      errors.push(
        'No transition sets game.gameEnded=true. At least one transition must explicitly end the game. ' +
        'Without this, the game cannot terminate properly.',
      );
    }

    // Check 2: At least one transition must set isGameWinner
    const isGameWinnerSetters = graph.findFieldSetters('players.*.isGameWinner');
    if (isGameWinnerSetters.length === 0) {
      errors.push(
        'No transition sets players.*.isGameWinner. At least one transition must mark winning players. ' +
        'Set isGameWinner=true for each winning player before or when the game ends. ' +
        'Runtime will automatically compute game.winningPlayers from these flags.',
      );
    }

    // Check 3: All terminal paths set isGameWinner somewhere along the path
    const terminalPaths = graph.getTerminalPaths();
    if (terminalPaths.length === 0) {
      errors.push('No paths from init to "finished" phase found. Game cannot end.');
    } else {
      let hasWinningPath = false;
      for (const path of terminalPaths) {
        if (graph.pathSetsField(path, 'players.*.isGameWinner')) {
          hasWinningPath = true;
          break;
        }
      }
      if (!hasWinningPath) {
        errors.push(
          'No path to "finished" sets players.*.isGameWinner. ' +
          'If your game has winners, at least one ending path must set isGameWinner=true for winning players. ' +
          'If this is a draw-only game (no winners), you can ignore this warning.',
        );
      }
    }
  } catch (error) {
    errors.push(`Error validating game completion: ${error instanceof Error ? error.message : String(error)}`);
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
    errors.push(`Error validating phase connectivity: ${error instanceof Error ? error.message : String(error)}`);
  }

  return errors;
}
