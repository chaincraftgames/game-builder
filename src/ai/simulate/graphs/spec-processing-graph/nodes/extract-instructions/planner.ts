/**
 * Instructions Planner Node
 * 
 * Analyzes spec and identifies semantic requirements for instruction execution
 */

import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { SpecProcessingStateType } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/spec-processing-state.js";
import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { planInstructionsTemplate } from "./prompts.js";
import { InstructionsPlanningResponseSchema, InstructionsPlanningResponseSchemaJson } from "./schema.js";
import {
  GraphConfigWithStore,
  incrementAttemptCount,
  putToStore,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/node-shared.js";
import { getAllAggregators, getNumericDataSourceIds } from "#chaincraft/ai/design/data-sources.js";

export function instructionsPlannerNode(model: ModelWithOptions) {
  return async (
    state: SpecProcessingStateType,
    config?: GraphConfigWithStore
  ): Promise<Partial<SpecProcessingStateType>> => {
    console.debug("[instructions_planner] Analyzing specification for semantic requirements");

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

    // Format valid data source IDs for the prompt
    const dataSources = state.dataSources || [];
    const validDataSourceIds = dataSources.length > 0
      ? dataSources.map((ds, i) => `${i + 1}. "${ds.id}" — ${ds.label || ds.id}`).join('\n')
      : "No data sources configured for this game.";

    // Format valid aggregator IDs for the prompt
    const aggregators = getAllAggregators();
    const numericIds = getNumericDataSourceIds();
    const validAggregatorIds = aggregators.length > 0
      ? aggregators.map((agg, i) =>
          `${i + 1}. "${agg.id}" — ${agg.label}. Returns: ${agg.resultFields.join(', ')}. ` +
          `Compatible with numeric data sources: ${numericIds.join(', ')}.`
        ).join('\n')
      : "No aggregators available.";
    
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
      validDataSourceIds,
      validAggregatorIds,
      validationFeedback: "",
    });

    const plannerResponse = await model.invokeWithSystemPrompt(
      plannerSystemMessage.content as string,
      undefined,
      {
        agent: "instructions-planner",
        workflow: "spec-processing",
      },
      InstructionsPlanningResponseSchema
    );

    const contentString = typeof plannerResponse === 'string' 
      ? plannerResponse 
      : JSON.stringify(plannerResponse, null, 2);
    
    // Using "instructions" namespace to match config and validators
    await putToStore(store, ["instructions", "plan", "output"], threadId, contentString);
    await incrementAttemptCount(store, "instructions", "plan", threadId);

    return {};
  };
}
