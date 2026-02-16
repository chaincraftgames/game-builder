/**
 * Transitions Planner Node
 *
 * Analyzes game specification and identifies required phases and transitions
 */

import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { SpecProcessingStateType } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/spec-processing-state.js";
import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { planTransitionsTemplate } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-transitions/prompts.js";
import { PlanningResponseSchemaJson } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-transitions/schema.js";
import {
  GraphConfigWithStore,
  incrementAttemptCount,
  putToStore,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/node-shared.js";
import {
  formatComputedContextForPrompt,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-transitions/utils.js";
import { extractSchemaFields } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/schema-utils.js";

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
          explain:
            "Game has not been initialized yet (currentPhase is init or undefined)",
        },
      ],
      humanSummary:
        "Initialize game state and transition to first gameplay phase",
    },
  ],
};

export function transitionsPlannerNode(model: ModelWithOptions) {
  return async (
    state: SpecProcessingStateType,
    config?: GraphConfigWithStore
  ): Promise<Partial<SpecProcessingStateType>> => {
    console.debug(
      "[transitions_planner] Analyzing specification for phases and transitions"
    );

    const store = config?.store;
    const threadId = config?.configurable?.thread_id || "default";

    // Extract fields from schema for explicit field list
    const schemaFields = JSON.parse(String(state.stateSchema ?? "[]"));
    const availableFields = extractSchemaFields(schemaFields);
    const fieldsListForPrompt = Array.from(availableFields).sort().map(f => `  • ${f}`).join('\n');
    const computedContextForPrompt = formatComputedContextForPrompt();

    // Generate planner analysis
    const plannerPrompt = SystemMessagePromptTemplate.fromTemplate(
      planTransitionsTemplate
    );
    const plannerSystemMessage = await plannerPrompt.format({
      gameSpecification: String(state.gameSpecification ?? ""),
      availableFields: fieldsListForPrompt,
      computedContextFields: computedContextForPrompt,
      planningSchemaJson: PlanningResponseSchemaJson,
      initialTransitionsTemplate: JSON.stringify(
        INITIAL_TRANSITIONS_TEMPLATE,
        null,
        2
      ),
    });

    const plannerAnalysis = await model.invokeWithSystemPrompt(
      plannerSystemMessage.content as string,
      undefined,
      {
        agent: "transitions-planner",
        workflow: "spec-processing",
      }
    );

    console.debug("[transitions_planner] Analysis complete");

    // Store raw output in store (not checkpointed)
    const contentString =
      typeof plannerAnalysis.content === "string"
        ? plannerAnalysis.content
        : JSON.stringify(plannerAnalysis.content);

    await putToStore(
      store,
      ["transitions", "plan", "output"],
      threadId,
      contentString
    );

    // Track attempt count in store
    await incrementAttemptCount(store, "transitions", "plan", threadId);

    return {};
  };
}
