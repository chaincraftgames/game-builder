/**
 * Instructions Planner Node
 * 
 * Analyzes spec and identifies WHAT instructions are needed (hints)
 */

import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { SpecProcessingStateType } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/spec-processing-state.js";
import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { planInstructionsTemplate } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-instructions/prompts.js";
import { InstructionsPlanningResponseSchemaJson } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-instructions/schema.js";
import {
  GraphConfigWithStore,
  incrementAttemptCount,
  putToStore,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/node-shared.js";

export function instructionsPlannerNode(model: ModelWithOptions) {
  return async (
    state: SpecProcessingStateType,
    config?: GraphConfigWithStore
  ): Promise<Partial<SpecProcessingStateType>> => {
    console.debug("[instructions_planner] Analyzing specification for instruction requirements");

    const store = config?.store;
    const threadId = config?.configurable?.thread_id || "default";

    // Parse transitions to extract phase names and transition IDs
    const transitionsArtifact = typeof state.stateTransitions === 'string' 
      ? JSON.parse(state.stateTransitions) 
      : state.stateTransitions ?? {};
    const phaseNames = transitionsArtifact.phases || [];
    const transitionIds = (transitionsArtifact.transitions || []).map((t: any) => ({
      id: t.id,
      fromPhase: t.fromPhase,
      toPhase: t.toPhase
    }));
    
    console.debug(`[instructions_planner] Extracted ${phaseNames.length} phase names: ${phaseNames.join(', ')}`);
    console.debug(`[instructions_planner] Extracted ${transitionIds.length} transition IDs`);
    
    // Format narrative markers section
    const narrativeMarkers = Object.keys(state.specNarratives || {});
    const narrativeMarkersSection = narrativeMarkers.length > 0
      ? `The following narrative markers are available for reference in instruction guidance:

${narrativeMarkers.map(m => `- !___ NARRATIVE:${m} ___!`).join('\n')}

These markers will be expanded at runtime to provide full narrative guidance to the LLM.`
      : "No narrative markers available for this game (purely mechanical game).";
    
    const plannerPrompt = SystemMessagePromptTemplate.fromTemplate(
      planInstructionsTemplate
    );

    const plannerSystemMessage = await plannerPrompt.format({
      gameSpecification: String(state.gameSpecification ?? ""),
      transitionsArtifact: String(state.stateTransitions ?? "{}"),
      phaseNamesList: phaseNames.map((p: string, i: number) => `${i + 1}. "${p}"`).join('\n'),
      transitionIdsList: transitionIds.map((t: any, i: number) => 
        `${i + 1}. id="${t.id}" (${t.fromPhase} → ${t.toPhase})`
      ).join('\n'),
      stateSchema: String(state.stateSchema ?? ""),
      planningSchemaJson: JSON.stringify(InstructionsPlanningResponseSchemaJson, null, 2),
      narrativeMarkersSection,
      validationFeedback: "", // Empty on first run, would contain errors on retry
    });

    const plannerResponse = await model.invokeWithSystemPrompt(
      plannerSystemMessage.content as string,
      undefined,
      {
        agent: "instructions-planner",
        workflow: "spec-processing",
      }
    );

    console.debug("[instructions_planner] Analysis complete");

    // Store raw output in store (not checkpointed)
    const contentString = typeof plannerResponse.content === 'string' 
      ? plannerResponse.content 
      : JSON.stringify(plannerResponse.content);
    
    await putToStore(store, ["instructions", "plan", "output"], threadId, contentString);

    // Track attempt count in store
    await incrementAttemptCount(store, "instructions", "plan", threadId);

    return {};
  };
}
