/**
 * Minimal Instructions Planner Node
 */

import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { SpecProcessingStateType } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/spec-processing-state.js";
import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { planInstructionsMinimalTemplate } from "./prompts.js";
import { InstructionsPlanningResponseMinimalSchema, InstructionsPlanningResponseMinimalSchemaJson } from "./schema.js";
import {
  GraphConfigWithStore,
  incrementAttemptCount,
  putToStore,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/node-shared.js";

export function instructionsPlannerMinimalNode(model: ModelWithOptions) {
  return async (
    state: SpecProcessingStateType,
    config?: GraphConfigWithStore
  ): Promise<Partial<SpecProcessingStateType>> => {
    console.debug("[instructions_planner_minimal] Analyzing specification for semantic requirements");

    const store = config?.store;
    const threadId = config?.configurable?.thread_id || "default";

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
      : "No narrative markers (purely mechanical game).";
    
    const plannerPrompt = SystemMessagePromptTemplate.fromTemplate(
      planInstructionsMinimalTemplate
    );

    const plannerSystemMessage = await plannerPrompt.format({
      gameSpecification: String(state.gameSpecification ?? ""),
      transitionsArtifact: String(state.stateTransitions ?? "{}"),
      phaseNamesList: phaseNames.map((p: string, i: number) => `${i + 1}. "${p}"`).join('\n'),
      transitionIdsList: transitionIds.map((t: any, i: number) => 
        `${i + 1}. id="${t.id}" (${t.fromPhase} → ${t.toPhase})`
      ).join('\n'),
      stateSchema: String(state.stateSchema ?? ""),
      planningSchemaJson: JSON.stringify(InstructionsPlanningResponseMinimalSchemaJson, null, 2),
      narrativeMarkersSection,
      validationFeedback: "",
    });

    const plannerResponse = await model.invokeWithSystemPrompt(
      plannerSystemMessage.content as string,
      undefined,
      {
        agent: "instructions-planner-minimal",
        workflow: "spec-processing",
      },
      InstructionsPlanningResponseMinimalSchema
    );

    const contentString = typeof plannerResponse === 'string' 
      ? plannerResponse 
      : JSON.stringify(plannerResponse, null, 2);
    
    await putToStore(store, ["instructions-minimal", "plan", "output"], threadId, contentString);
    await incrementAttemptCount(store, "instructions-minimal", "plan", threadId);

    return {};
  };
}