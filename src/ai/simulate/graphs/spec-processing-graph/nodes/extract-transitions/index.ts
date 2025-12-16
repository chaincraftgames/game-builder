/**
 * Extract Transitions Node
 *
 * Analyzes game specification and identifies:
 * - Game phases (setup, playing, scoring, finished, etc.)
 * - Transition conditions (when to move between phases)
 * - Phase-specific state changes
 * - Whether each phase requires player input or is automatic
 */

import { z } from "zod";
import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { SpecProcessingStateType } from "../../spec-processing-state.js";
import {
  planTransitionsTemplate,
  executeTransitionsTemplate,
} from "./prompts.js";
import {
  TransitionsArtifact,
  TransitionsArtifactSchema,
  TransitionsArtifactSchemaJson,
} from "#chaincraft/ai/simulate/schema.js";
import {
  PlanningResponseSchema,
  PlanningResponseSchemaJson,
} from "./schema.js";
import {
  JsonLogicSchema,
  JsonLogicSchemaJson,
  RouterContextSchema,
} from "#chaincraft/ai/simulate/logic/jsonlogic.js";
import extractJsonBlocks from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-transitions/extractJsonBlocks.js";

/**
 * Extract field paths from JSON Schema for explicit field list in prompts.
 * Only extracts flat fields (one level under game/players).
 */
function extractFieldsFromJsonSchema(schemaJson: string): Array<{
  path: string;
  type: string;
  description: string;
}> {
  try {
    const schema = JSON.parse(schemaJson);
    const fields: Array<{ path: string; type: string; description: string }> = [];

    // Extract game-level fields
    if (schema.properties?.game?.properties) {
      Object.entries(schema.properties.game.properties).forEach(
        ([key, prop]: [string, any]) => {
          fields.push({
            path: `game.${key}`,
            type: prop.type || "any",
            description: prop.description || "",
          });
        }
      );
    }

    // Extract player-level fields (with [*] wildcard)
    if (schema.properties?.players?.additionalProperties?.properties) {
      Object.entries(
        schema.properties.players.additionalProperties.properties
      ).forEach(([key, prop]: [string, any]) => {
        fields.push({
          path: `players[*].${key}`,
          type: prop.type || "any",
          description: prop.description || "",
        });
      });
    }

    return fields.sort((a, b) => a.path.localeCompare(b.path));
  } catch (error) {
    console.warn("[extract_transitions] Failed to extract field paths:", error);
    return [];
  }
}

/**
 * Format computed context fields list for prompt injection.
 * Creates clear list of exact field names available from router context.
 */
function formatComputedContextForPrompt(): string {
  const schema = RouterContextSchema.shape;
  let output = "Computed Context Fields (available during precondition evaluation):\n\n";
  
  for (const [fieldName, zodType] of Object.entries(schema)) {
    const description = (zodType as any)._def?.description || "";
    const typeName = (zodType as any)._def?.typeName === "ZodBoolean" ? "boolean" : "number";
    output += `  • ${fieldName} (${typeName}) - ${description}\n`;
  }
  
  output += "\nIMPORTANT: Use these EXACT field names in preconditions. Do NOT invent similar names.";
  
  return output;
}

/**
 * Format fields list for prompt injection.
 * Creates clear, readable list of available state fields.
 */
function formatFieldsListForPrompt(
  fields: Array<{ path: string; type: string; description: string }>
): string {
  if (fields.length === 0) {
    return "No additional fields defined beyond base schema.";
  }

  const gameFields = fields.filter((f) => f.path.startsWith("game."));
  const playerFields = fields.filter((f) => f.path.startsWith("players[*]."));

  let output =
    "Available State Fields (ONLY reference these exact paths in preconditions):\n\n";

  if (gameFields.length > 0) {
    output += "Game-level fields:\n";
    gameFields.forEach((f) => {
      const desc = f.description ? ` - ${f.description}` : "";
      output += `  • ${f.path} (${f.type})${desc}\n`;
    });
  }

  if (playerFields.length > 0) {
    output += "\nPer-player fields (use [*] wildcard for all players):\n";
    playerFields.forEach((f) => {
      const desc = f.description ? ` - ${f.description}` : "";
      output += `  • ${f.path} (${f.type})${desc}\n`;
    });
  }

  return output;
}

/**
 * Initial transitions template with required init phase and transition.
 * The LLM fills in init details and adds gameplay transitions.
 */
const INITIAL_TRANSITIONS_TEMPLATE = {
  phases: ["init"],
  phaseMetadataHints: [
    {
      phase: "init",
      requiresPlayerInput: false,
    },
  ],
  transitionCandidates: [
    {
      id: "initialize_game",
      fromPhase: "init",
      toPhase: "<FIRST_GAMEPLAY_PHASE>",
      priority: 1,
      condition: "Game starts - set up initial state",
      checkedFields: ["game.currentPhase"],
      computedValues: {},
      preconditionHints: [
        {
          id: "game_not_initialized",
          deterministic: true,
          explain: "Game has not been initialized yet (currentPhase is init or undefined)",
        },
      ],
      humanSummary: "Initialize game state and transition to first gameplay phase",
    },
  ],
};

export function extractTransitions(model: ModelWithOptions) {
  return async (
    state: SpecProcessingStateType
  ): Promise<Partial<SpecProcessingStateType>> => {
    console.debug(
      "[extract_transitions] Extracting state transitions from specification"
    );
    let transitions: TransitionsArtifact | null = null;
    let stateTransitionsJson: string | undefined = undefined;

    // Extract fields from schema for explicit field list
    const availableFields = extractFieldsFromJsonSchema(
      String(state.stateSchema ?? "{}")
    );
    const fieldsListForPrompt = formatFieldsListForPrompt(availableFields);
    const computedContextForPrompt = formatComputedContextForPrompt();

    const plannerPrompt = SystemMessagePromptTemplate.fromTemplate(
      planTransitionsTemplate
    );

    const plannerSystemMessage = await plannerPrompt.format({
      gameSpecification: String(state.gameSpecification ?? ""),
      availableFields: fieldsListForPrompt,
      computedContextFields: computedContextForPrompt,
      planningSchemaJson: PlanningResponseSchemaJson,
      initialTransitionsTemplate: JSON.stringify(INITIAL_TRANSITIONS_TEMPLATE, null, 2),
    });

    const plannerResponse = await model.invokeWithSystemPrompt(
      plannerSystemMessage.content as string,
      undefined,
      {
        agent: "extract-transitions-planner",
        workflow: "spec-processing",
      }
    );

    const transitionsPlan =
      plannerResponse && (plannerResponse as any).content
        ? ((plannerResponse as any).content as string)
        : "";

    // Attempt to detect JSON planner output and run a heuristic validation; warn on failure.
    try {
      const jsonStr = extractJsonBlocks(transitionsPlan);
      if (jsonStr) {
        const maybe = JSON.parse(jsonStr);
        const parsed = PlanningResponseSchema.safeParse(maybe);
        if (parsed.success) {
          const check = validatePhaseCoverage(parsed.data);
          if (!check.ok) {
            console.warn(
              "[extract_transitions][planner-check] Planner heuristic validation failed:",
              JSON.stringify(check.errors)
            );
          }
        }
      }
    } catch (e) {
      // Planner likely returned NL text; skip planner precheck.
    }

    // Step 2: Attempt a structured extraction using the planner's NL transitionsPlan + schema
    const executePrompt = SystemMessagePromptTemplate.fromTemplate(
      executeTransitionsTemplate
    );
    const executeSystemMessage = await executePrompt.format({
      transitionsPlan: String(transitionsPlan ?? ""),
      availableFields: fieldsListForPrompt,
      computedContextFields: computedContextForPrompt,
      jsonLogicSchema: JsonLogicSchemaJson,
      transitionsArtifactSchema: TransitionsArtifactSchemaJson,
    });

    const transitionsResponse = await model.invokeWithSystemPrompt(
      executeSystemMessage.content as string,
      undefined,
      {
        agent: "extract-transitions",
        workflow: "spec-processing",
      },
      TransitionsArtifactSchema
    );

    transitions = TransitionsArtifactSchema.parse(
      transitionsResponse
    );

    // validate any provided JsonLogic in the precondition hints
    const invalid: Array<{ transitionId?: string; errors: any }> = [];
    if (transitions && Array.isArray(transitions.transitions)) {
      for (const t of transitions.transitions) {
        const hints = Array.isArray(t.preconditions) ? t.preconditions : [];
        for (const h of hints) {
          if (h.deterministic !== false && h.logic != null) {
            const parsed = JsonLogicSchema.safeParse(h.logic);
            if (!parsed.success) {
              invalid.push({
                transitionId: t.id,
                errors: parsed.error.format(),
              });
            }
          }
        }
      }
    }

    if (invalid.length > 0) {
      console.error(
        "[extract_transitions] Invalid JsonLogic detected:",
        JSON.stringify(invalid, null, 2)
      );
      throw new Error("Invalid JsonLogic in transitions artifact");
    }

    // Additional structural validations: transition coverage and determinism
    const coverageErrors: string[] = [];
    const nonDeterministic: Array<{
      transitionId: string;
      preconditionId?: string;
    }> = [];

    if (
      !transitions ||
      !Array.isArray(transitions.phases) ||
      !Array.isArray(transitions.transitions)
    ) {
      console.warn(
        "[extract_transitions] Transitions artifact missing `phases` or `transitions` arrays"
      );
    } else {
      const phases = transitions.phases as string[];
      const fromCounts: Record<string, number> = {};
      const toCounts: Record<string, number> = {};

      for (const t of transitions.transitions) {
        const from = String((t as any).fromPhase || (t as any).from || "");
        const to = String((t as any).toPhase || (t as any).to || "");
        fromCounts[from] = (fromCounts[from] || 0) + 1;
        toCounts[to] = (toCounts[to] || 0) + 1;

        const preconds = Array.isArray((t as any).preconditions)
          ? (t as any).preconditions
          : [];
        for (const p of preconds) {
          if (p && p.deterministic === false) {
            nonDeterministic.push({ transitionId: t.id, preconditionId: p.id });
          }
        }
      }

      // from every phase except the last, expect at least one outgoing transition
      for (let i = 0; i < phases.length - 1; i++) {
        const phase = phases[i];
        if (!fromCounts[phase]) {
          coverageErrors.push(`No outgoing transitions from phase '${phase}'`);
        }
      }

      // to every phase except the first, expect at least one incoming transition
      for (let i = 1; i < phases.length; i++) {
        const phase = phases[i];
        if (!toCounts[phase]) {
          coverageErrors.push(`No incoming transitions to phase '${phase}'`);
        }
      }
    }

    // Handle validation results: by default warn, but allow strict mode via state flags
    const enforceCoverage = Boolean((state as any)?.enforceTransitionCoverage);
    const requireDeterministic = Boolean(
      (state as any)?.requireDeterministicTransitions
    );

    if (coverageErrors.length > 0) {
      const msg = `[extract_transitions] Transition coverage issues:\n${coverageErrors.join(
        "\n"
      )}`;
      if (enforceCoverage) {
        console.error(msg);
        throw new Error("Transition coverage validation failed");
      } else {
        console.warn(msg);
      }
    }

    if (nonDeterministic.length > 0) {
      const msg = `[extract_transitions] Non-deterministic preconditions detected: ${JSON.stringify(
        nonDeterministic
      )}`;
      if (requireDeterministic) {
        console.error(msg);
        throw new Error("Non-deterministic preconditions found");
      } else {
        console.warn(msg);
      }
    }
    // store JSON version for runtime use
    stateTransitionsJson = JSON.stringify(transitions, null, 2);
    console.debug(
      "[extract_transitions] Structured transitions extracted successfully"
    );

    console.debug(
      "[extract_transitions] Transition guide generated successfully"
    );
    console.debug(
      `[extract_transitions] Output length: ${stateTransitionsJson?.length} characters`
    );

    const out: Partial<SpecProcessingStateType> = {
      stateTransitions: stateTransitionsJson,
    };

    if (stateTransitionsJson)
      (out as any).stateTransitionsJson = stateTransitionsJson;
    if (transitions)
      (out as any).stateTransitions = transitions as unknown as any;

    return out;
  };
}

// Helper: validate a planning-like artifact (either planner JSON or final transitions).
function validatePhaseCoverage(artifact: any): {
  ok: boolean;
  errors: string[];
  nonDeterministicHints: Array<any>;
} {
  const errors: string[] = [];
  const nonDeterministicHints: Array<any> = [];

  if (!artifact || !Array.isArray(artifact.phases)) {
    errors.push("Missing or invalid `phases` array");
    return { ok: false, errors, nonDeterministicHints };
  }

  const phases = artifact.phases as string[];
  if (phases.length === 0) {
    errors.push("No phases detected");
    return { ok: false, errors, nonDeterministicHints };
  }

  // Validate required special phases
  if (phases[0] !== "init") {
    errors.push("First phase must be 'init'");
  }
  if (phases[phases.length - 1] !== "finished") {
    errors.push("Last phase must be 'finished'");
  }

  // Determine which transition array to inspect: planner uses `transitionCandidates`, executor uses `transitions`.
  const candidates = Array.isArray(artifact.transitionCandidates)
    ? artifact.transitionCandidates
    : Array.isArray(artifact.transitions)
    ? artifact.transitions
    : [];

  const fromCounts: Record<string, number> = {};
  const toCounts: Record<string, number> = {};

  for (const c of candidates) {
    const from = String((c as any).fromPhase || (c as any).from || "");
    const to = String((c as any).toPhase || (c as any).to || "");
    if (from) fromCounts[from] = (fromCounts[from] || 0) + 1;
    if (to) toCounts[to] = (toCounts[to] || 0) + 1;

    const preconds = Array.isArray((c as any).preconditions)
      ? (c as any).preconditions
      : Array.isArray((c as any).preconditionHints)
      ? (c as any).preconditionHints
      : [];
    for (const p of preconds) {
      if (p && p.deterministic === false)
        nonDeterministicHints.push({ candidate: c.id, hint: p.id });
    }
  }

  // Check coverage: from all except last, to all except first
  for (let i = 0; i < phases.length - 1; i++) {
    const phase = phases[i];
    if (!fromCounts[phase])
      errors.push(`No outgoing transition from phase '${phase}'`);
  }
  for (let i = 1; i < phases.length; i++) {
    const phase = phases[i];
    if (!toCounts[phase])
      errors.push(`No incoming transition to phase '${phase}'`);
  }
  
  // Validate special phases have required transitions
  if (!fromCounts["init"]) {
    errors.push("No transition from 'init' phase (initialize_game required)");
  }
  if (!toCounts["finished"]) {
    errors.push("No transition to 'finished' phase (game-ending transition required)");
  }

  return { ok: errors.length === 0, errors, nonDeterministicHints };
}
