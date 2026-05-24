/**
 * Instructions Executor Node
 * Uses simplified hints but generates same output structure
 */

import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { SpecProcessingStateType } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/spec-processing-state.js";
import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { executeInstructionsTemplate } from "./prompts.js";
import {
  InstructionsArtifactSchema,
  InstructionsArtifactSchemaJson,
  type AutomaticTransitionInstruction,
} from "#chaincraft/ai/simulate/schema.js";
import {
  InstructionsPlanningResponse,
  InstructionsPlanningResponseSchema,
  type AutomaticTransitionHint,
} from "./schema.js";
import {
  getFromStore,
  GraphConfigWithStore,
  incrementAttemptCount,
  putToStore,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/node-shared.js";
import { getAllAggregators, getNumericDataSourceIds } from "#chaincraft/ai/design/data-sources.js";

/**
 * Remove router-controlled fields (currentPhase, gameEnded) from the stateSchema
 * before passing it to the instructions LLM. These fields cannot be set by mechanics
 * or stateDelta — the router owns them exclusively. Hiding them prevents the LLM from
 * generating ops that target them, which would be silently dropped at runtime.
 */
function filterRouterControlledFields(stateSchema: string): string {
  try {
    const fields = JSON.parse(stateSchema);
    if (!Array.isArray(fields)) return stateSchema;
    const ROUTER_FIELDS = new Set(['currentPhase', 'gameEnded']);
    const filtered = fields.filter((f: any) => !ROUTER_FIELDS.has(f.name));
    return JSON.stringify(filtered);
  } catch {
    return stateSchema;
  }
}

/**
 * Build an AutomaticTransitionInstruction directly from a planner hint,
 * without calling the LLM. Used for automatic non-init transitions where:
 *   - stateDelta must be [] (all state setup is in mechanic code)
 *   - mechanicsGuidance is populated from the planner's freeform description
 */
function buildTransitionInstructionFromHint(
  hint: AutomaticTransitionHint,
): AutomaticTransitionInstruction {
  const rules: string[] = [];
  if (hint.mechanicsDescription) {
    rules.push(hint.mechanicsDescription);
  }
  if (hint.usesRandomness && hint.randomnessDescription) {
    rules.push(`Randomness: ${hint.randomnessDescription}`);
  }

  return {
    id: hint.id,
    transitionName: hint.transitionName,
    mechanicsGuidance: rules.length > 0 ? { rules, computation: hint.mechanicsDescription ?? undefined } : null,
    stateDelta: [],
    messages: null,
    imageContentSpec: hint.imageContentSpec ?? null,
    narrativeKeys: hint.narrativeKeys?.length ? hint.narrativeKeys : undefined,
  };
}


export function instructionsExecutorNode(model: ModelWithOptions) {
  return async (
    state: SpecProcessingStateType,
    config?: GraphConfigWithStore
  ): Promise<Partial<SpecProcessingStateType>> => {
    console.debug("[instructions_executor] Generating instructions from hints");

    const store = config?.store;
    const threadId = config?.configurable?.thread_id || "default";

    let plannerOutput: string;
    if (store) {
      // Using "instructions" namespace to match config
      plannerOutput = await getFromStore(
        store,
        ["instructions", "plan", "output"],
        threadId
      );
    } else {
      throw new Error("[instructions_executor] Store not configured");
    }

    if (!plannerOutput) {
      throw new Error("[instructions_executor] No planner output found");
    }

    let plannerHints: InstructionsPlanningResponse;
    try {
      let jsonStr = plannerOutput.trim();
      if (jsonStr.startsWith('```json')) jsonStr = jsonStr.substring(7);
      else if (jsonStr.startsWith('```')) jsonStr = jsonStr.substring(3);
      if (jsonStr.endsWith('```')) jsonStr = jsonStr.substring(0, jsonStr.length - 3);
      jsonStr = jsonStr.trim();
      
      const parsedJson = JSON.parse(jsonStr);
      plannerHints = InstructionsPlanningResponseSchema.parse(parsedJson);
      
      console.debug(
        `[instructions_executor] Parsed ${plannerHints.playerPhases.length} phases, ${plannerHints.transitions.length} transitions`
      );
    } catch (error) {
      console.error("[instructions_executor] Failed to parse planner output:", error);
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

    // ── Classify transitions ─────────────────────────────────────────────────
    // Automatic non-init transitions bypass the LLM executor entirely:
    //   - stateDelta must always be [] (all state work belongs in mechanic code)
    //   - mechanicsGuidance is built directly from the planner hint
    // Only init-phase transitions and player-action phases go to the LLM.
    const initTransitionIds = new Set<string>(
      (transitionsArtifact.transitions || [])
        .filter((t: any) => t.fromPhase === 'init')
        .map((t: any) => t.id as string)
    );

    // Build programmatic entries for all automatic non-init transitions
    const programmaticTransitions: Record<string, AutomaticTransitionInstruction> = {};
    const hintsForLLM = plannerHints.transitions.filter((hint) => {
      if (initTransitionIds.has(hint.id)) return true; // init → LLM handles it
      // Non-init automatic transition → bypass LLM
      programmaticTransitions[hint.id] = buildTransitionInstructionFromHint(hint);
      return false;
    });

    console.debug(
      `[instructions_executor] Bypassing LLM for ${Object.keys(programmaticTransitions).length} automatic non-init transition(s): ` +
      Object.keys(programmaticTransitions).join(', ')
    );
    console.debug(
      `[instructions_executor] Sending ${hintsForLLM.length} transition(s) + ${plannerHints.playerPhases.length} player phase(s) to LLM`
    );

    // If there's nothing left for the LLM (no init transitions, no player phases),
    // build a minimal artifact from programmatic entries only and skip the LLM call.
    if (hintsForLLM.length === 0 && plannerHints.playerPhases.length === 0) {
      const artifact = {
        version: "1.0.0",
        generatedAt: new Date().toISOString(),
        playerPhases: {},
        transitions: programmaticTransitions,
        metadata: {
          totalPlayerPhases: 0,
          totalTransitions: Object.keys(programmaticTransitions).length,
          deterministicInstructionCount: Object.keys(programmaticTransitions).length,
          llmDrivenInstructionCount: 0,
        },
      };
      const contentString = JSON.stringify(artifact, null, 2);
      await putToStore(store, ["instructions", "execution", "output"], threadId, contentString);
      await incrementAttemptCount(store, "instructions", "execution", threadId);
      return {};
    }

    // Pass filtered hints to LLM (init transitions + player phases only)
    const filteredPlannerHints = { ...plannerHints, transitions: hintsForLLM };

    const narrativeMarkers = Object.keys(state.specNarratives || {});
    const narrativeMarkersSection = narrativeMarkers.length > 0
      ? `Available markers: ${narrativeMarkers.map(m => `!___ NARRATIVE:${m} ___!`).join(', ')}`
      : "No narrative markers.";

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
          `Use extractField to pick a specific result field.`
        ).join('\n')
      : "No aggregators available.";

    const executorPrompt = SystemMessagePromptTemplate.fromTemplate(
      executeInstructionsTemplate
    );

    const executorSystemMessage = await executorPrompt.format({
      gameSpecificationSummary: String(state.gameSpecification ?? "").substring(0, 1000),
      stateSchema: filterRouterControlledFields(String(state.stateSchema ?? "")),
      actionDefinitions: state.actionDefinitions ?? "{}",
      plannerHints: JSON.stringify(filteredPlannerHints, null, 2),
      phaseNamesList: phaseNames.map((p: string, i: number) => `${i + 1}. "${p}"`).join('\n'),
      transitionIdsList: transitionIds.map((t: any, i: number) =>
        `${i + 1}. id="${t.id}" (${t.fromPhase} → ${t.toPhase})`
      ).join('\n'),
      executorSchemaJson: JSON.stringify(InstructionsArtifactSchemaJson, null, 2),
      narrativeMarkersSection,
      validDataSourceIds,
      validAggregatorIds,
      validationFeedback: "",
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

    // Merge programmatic transitions into the LLM response
    const mergedResponse = typeof executorResponse === 'string'
      ? JSON.parse(executorResponse)
      : { ...(executorResponse as any) };

    mergedResponse.transitions = {
      ...(mergedResponse.transitions ?? {}),
      ...programmaticTransitions,
    };
    // Update metadata counts to reflect merged result
    if (mergedResponse.metadata) {
      const programmaticCount = Object.keys(programmaticTransitions).length;
      mergedResponse.metadata.totalTransitions =
        Object.keys(mergedResponse.transitions).length;
      mergedResponse.metadata.deterministicInstructionCount =
        (mergedResponse.metadata.deterministicInstructionCount ?? 0) + programmaticCount;
    }

    const contentString = JSON.stringify(mergedResponse, null, 2);
    // Using "instructions" namespace to match config and validators
    await putToStore(store, ["instructions", "execution", "output"], threadId, contentString);
    await incrementAttemptCount(store, "instructions", "execution", threadId);

    return {};
  };
}
