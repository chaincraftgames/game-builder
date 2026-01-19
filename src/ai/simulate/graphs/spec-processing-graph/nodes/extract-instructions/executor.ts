/**
 * Instructions Executor Node
 *
 * Transforms planner hints into concrete templated instructions
 */

import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { SpecProcessingStateType } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/spec-processing-state.js";
import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { executeInstructionsTemplate } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-instructions/prompts.js";
import {
  InstructionsArtifactSchema,
  InstructionsArtifactSchemaJson,
} from "#chaincraft/ai/simulate/schema.js";
import {
  InstructionsPlanningResponse,
  InstructionsPlanningResponseSchema,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-instructions/schema.js";
import {
  getFromStore,
  GraphConfigWithStore,
  incrementAttemptCount,
  putToStore,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/node-shared.js";

export function instructionsExecutorNode(model: ModelWithOptions) {
  return async (
    state: SpecProcessingStateType,
    config?: GraphConfigWithStore
  ): Promise<Partial<SpecProcessingStateType>> => {
    console.debug("[instructions_executor] Generating concrete templated instructions");

    const store = config?.store;
    const threadId = config?.configurable?.thread_id || "default";

    // Retrieve planner output from store
    let plannerOutput: string;
    if (store) {
      plannerOutput = await getFromStore(
        store,
        ["instructions", "plan", "output"],
        threadId
      );
    } else {
      throw new Error(
        "[instructions_executor] Store not configured - cannot retrieve planner output"
      );
    }

    if (!plannerOutput) {
      throw new Error("[instructions_executor] No planner output found in store");
    }

    // Parse planner hints
    let plannerHints: InstructionsPlanningResponse;
    try {
      // Remove markdown code fences if present
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
      plannerHints = InstructionsPlanningResponseSchema.parse(parsedJson);
      
      console.debug(
        `[instructions_executor] Parsed ${plannerHints.playerPhases.length} player phases, ${plannerHints.transitions.length} transitions`
      );
    } catch (error) {
      console.error("[instructions_executor] Failed to parse planner output:", error);
      throw new Error(`Planner output validation failed: ${error}`);
    }

    // Extract phase names and transition IDs from planner hints
    const plannerPhaseNames = plannerHints.playerPhases.map(pi => pi.phase);
    const plannerTransitionIds = plannerHints.transitions.map(t => ({ 
      id: t.id, 
      basedOnTransition: t.trigger.basedOnTransition 
    }));
    
    // Format narrative markers section
    const narrativeMarkers = Object.keys(state.specNarratives || {});
    const narrativeMarkersSection = narrativeMarkers.length > 0
      ? `The following narrative markers are available for reference in instruction guidance:

${narrativeMarkers.map(m => `- !___ NARRATIVE:${m} ___!`).join('\n')}

These markers will be expanded at runtime to provide full narrative guidance to the LLM.`
      : "No narrative markers available for this game (purely mechanical game).";
    
    const executorPrompt = SystemMessagePromptTemplate.fromTemplate(
      executeInstructionsTemplate
    );

    const executorSystemMessage = await executorPrompt.format({
      phaseNamesList: plannerPhaseNames.map((p: string, i: number) => `${i + 1}. "${p}"`).join('\n'),
      transitionIdsList: plannerTransitionIds.map((t: any, i: number) => 
        `${i + 1}. id="${t.id}"`
      ).join('\n'),
      stateSchema: String(state.stateSchema ?? ""),
      plannerHints: JSON.stringify(plannerHints, null, 2),
      executorSchemaJson: JSON.stringify(InstructionsArtifactSchemaJson, null, 2),
      narrativeMarkersSection,
      gameSpecificationSummary: `Game: ${(state.gameSpecification as any)?.summary || 'Untitled Game'}\nPlayer Count: ${(state.gameSpecification as any)?.playerCount?.min || '?'}-${(state.gameSpecification as any)?.playerCount?.max || '?'}`,
      validationFeedback: "", // Empty on first run, would contain errors on retry
    });

    const executorResponse = await model.invokeWithSystemPrompt(
      executorSystemMessage.content as string,
      undefined,
      {
        agent: "instructions-executor",
        workflow: "spec-processing",
      },
      InstructionsArtifactSchema
    );

    console.debug("[instructions_executor] Instruction generation complete");

    // Store raw execution output in store (not checkpointed)
    await putToStore(store, ["instructions", "execution", "output"], threadId, JSON.stringify(executorResponse));

    // Track attempt count in store
    await incrementAttemptCount(store, "instructions", "execution", threadId);

    return {};
  };
}
