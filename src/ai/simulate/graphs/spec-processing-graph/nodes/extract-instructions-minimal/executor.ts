/**
 * Minimal Instructions Executor Node
 * Uses simplified hints but generates same output structure
 */

import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { SpecProcessingStateType } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/spec-processing-state.js";
import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { executeInstructionsTemplate } from "../extract-instructions/prompts.js";
import {
  InstructionsArtifactSchema,
  InstructionsArtifactSchemaJson,
} from "#chaincraft/ai/simulate/schema.js";
import {
  InstructionsPlanningResponseMinimal,
  InstructionsPlanningResponseMinimalSchema,
} from "./schema.js";
import {
  getFromStore,
  GraphConfigWithStore,
  incrementAttemptCount,
  putToStore,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/node-shared.js";

export function instructionsExecutorMinimalNode(model: ModelWithOptions) {
  return async (
    state: SpecProcessingStateType,
    config?: GraphConfigWithStore
  ): Promise<Partial<SpecProcessingStateType>> => {
    console.debug("[instructions_executor_minimal] Generating instructions from minimal hints");

    const store = config?.store;
    const threadId = config?.configurable?.thread_id || "default";

    let plannerOutput: string;
    if (store) {
      plannerOutput = await getFromStore(
        store,
        ["instructions-minimal", "plan", "output"],
        threadId
      );
    } else {
      throw new Error("[instructions_executor_minimal] Store not configured");
    }

    if (!plannerOutput) {
      throw new Error("[instructions_executor_minimal] No planner output found");
    }

    let plannerHints: InstructionsPlanningResponseMinimal;
    try {
      let jsonStr = plannerOutput.trim();
      if (jsonStr.startsWith('```json')) jsonStr = jsonStr.substring(7);
      else if (jsonStr.startsWith('```')) jsonStr = jsonStr.substring(3);
      if (jsonStr.endsWith('```')) jsonStr = jsonStr.substring(0, jsonStr.length - 3);
      jsonStr = jsonStr.trim();
      
      const parsedJson = JSON.parse(jsonStr);
      plannerHints = InstructionsPlanningResponseMinimalSchema.parse(parsedJson);
      
      console.debug(
        `[instructions_executor_minimal] Parsed ${plannerHints.playerPhases.length} phases, ${plannerHints.transitions.length} transitions`
      );
    } catch (error) {
      console.error("[instructions_executor_minimal] Failed to parse planner output:", error);
      throw new Error(`Planner output validation failed: ${error}`);
    }

    const transitionsArtifact = typeof state.stateTransitions === 'string'
      ? JSON.parse(state.stateTransitions)
      : state.stateTransitions ?? {};
    const phaseNames = transitionsArtifact.phases || [];
    const transitionIds = (transitionsArtifact.transitions || []).map((t: any) => ({
      id: t.id,
      fromPhase: t.fromPhase,
      toPhase: t.toPhase
    }));

    const narrativeMarkers = Object.keys(state.specNarratives || {});
    const narrativeMarkersSection = narrativeMarkers.length > 0
      ? `Available markers: ${narrativeMarkers.map(m => `!___ NARRATIVE:${m} ___!`).join(', ')}`
      : "No narrative markers.";

    const executorPrompt = SystemMessagePromptTemplate.fromTemplate(
      executeInstructionsTemplate
    );

    const executorSystemMessage = await executorPrompt.format({
      gameSpecificationSummary: String(state.gameSpecification ?? "").substring(0, 1000),
      stateSchema: String(state.stateSchema ?? ""),
      plannerHints: JSON.stringify(plannerHints, null, 2),
      phaseNamesList: phaseNames.map((p: string, i: number) => `${i + 1}. "${p}"`).join('\n'),
      transitionIdsList: transitionIds.map((t: any, i: number) =>
        `${i + 1}. id="${t.id}" (${t.fromPhase} → ${t.toPhase})`
      ).join('\n'),
      executorSchemaJson: JSON.stringify(InstructionsArtifactSchemaJson, null, 2),
      narrativeMarkersSection,
      validationFeedback: "",
    });

    const executorResponse = await model.invokeWithSystemPrompt(
      executorSystemMessage.content as string,
      undefined,
      {
        agent: "instructions-executor-minimal",
        workflow: "spec-processing",
      },
      InstructionsArtifactSchema
    );

    const contentString = typeof executorResponse === 'string' 
      ? executorResponse 
      : JSON.stringify(executorResponse, null, 2);
    await putToStore(store, ["instructions-minimal", "execute", "output"], threadId, contentString);
    await incrementAttemptCount(store, "instructions-minimal", "execution", threadId);

    return {};
  };
}