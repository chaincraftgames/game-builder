/**
 * Spec Processing Graph
 *
 * Transforms game specification into runtime artifacts:
 * 1. extract_schema - Generate state schema
 * 2. extract_transitions - Identify phase transitions
 * 3. validate_transitions - Structural validation
 * 4. repair_transitions - (if errors) Artifact editor fixes transitions
 * 5. extract_instructions - Create phase-specific instructions
 * 6. repair_artifacts - (if errors) Artifact editor cross-artifact repair
 * 7. generate_mechanics - Generate deterministic code for transitions with mechanicsGuidance
 * 8. repair_mechanics - (if tsc errors) Re-invoke mechanics subgraph with error context
 * 9. coherence_check - Cross-artifact consistency check
 * 10. extract_produced_tokens - Identify persistent tokens to produce
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { BaseCheckpointSaver } from "@langchain/langgraph";
import { SpecProcessingState } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/spec-processing-state.js";
import type { GameCreationBus } from "#chaincraft/events/game-creation-status-bus.js";
import { schemaExtractionConfig } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-schema/index.js";
import { actionDefinitionsExtractionConfig } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-action-definitions/index.js";
import { transitionsExtractionConfig } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-transitions/index.js";
import { instructionsExtractionConfig } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-instructions/index.js";
import { producedTokensExtractionConfig } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-produced-tokens/index.js";
import { createValidationNode } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/validate-transitions/index.js";
import { createExtractionSubgraph } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/node-factories.js";
import { 
  createRepairTransitionsNode, 
  createRepairArtifactsNode, 
  createRepairMechanicsNode, 
  createRepairCoherenceNode 
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/repair-artifacts/index.js";
import { 
  createMechanicsGraph, 
  buildMechanicTargets 
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/generate-mechanics/index.js";
import { generateStateInterfaces } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/generate-mechanics/generate-state-interfaces.js";
import type { GameStateField } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-schema/schema.js";
import { coherenceCheckNode } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/coherence-check/index.js";

/**
 * Creates and compiles the spec processing graph.
 * Processes game specification into schema, transitions, and instructions.
 *
 * @param checkpointer - Optional checkpoint saver for state persistence
 * @returns Compiled graph
 */
export async function createSpecProcessingGraph(
  checkpointer?: BaseCheckpointSaver
) {
  const workflow = new StateGraph(SpecProcessingState);

  // Create extraction subgraphs
  const schemaSubgraph = createExtractionSubgraph(schemaExtractionConfig);
  const actionDefinitionsSubgraph = createExtractionSubgraph(actionDefinitionsExtractionConfig);
  const transitionsSubgraph = createExtractionSubgraph(transitionsExtractionConfig);
  const instructionsSubgraph = createExtractionSubgraph(instructionsExtractionConfig);
  const producedTokensSubgraph = createExtractionSubgraph(producedTokensExtractionConfig);

  // Create validation node for transitions
  const validationNode = createValidationNode();

  // Create repair nodes (artifact editor wrappers)
  const repairTransitionsNode = createRepairTransitionsNode();
  const repairArtifactsNode = createRepairArtifactsNode();
  const repairMechanicsNode = createRepairMechanicsNode();
  const repairCoherenceNode = createRepairCoherenceNode();

  // Create mechanics generation subgraph
  const mechanicsGraph = await createMechanicsGraph();

  // Add nodes to graph - subgraphs need to receive config with store
  workflow.addNode("extract_schema", async (state, config) => {
    const bus = config?.configurable?.statusBus as GameCreationBus | undefined;
    bus?.emit({ type: 'artifact:started', artifact: 'stateSchema' });
    try {
      const result = await schemaSubgraph.invoke(state, config);
      bus?.emit({ type: 'artifact:completed', artifact: 'stateSchema' });
      return result;
    } catch (err) {
      bus?.emit({ type: 'artifact:error', artifact: 'stateSchema', error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  });
  workflow.addNode("extract_action_definitions", async (state, config) => {
    const bus = config?.configurable?.statusBus as GameCreationBus | undefined;
    bus?.emit({ type: 'artifact:started', artifact: 'actionDefinitions' });
    try {
      const result = await actionDefinitionsSubgraph.invoke(state, config);
      bus?.emit({ type: 'artifact:completed', artifact: 'actionDefinitions' });
      return result;
    } catch (err) {
      bus?.emit({ type: 'artifact:error', artifact: 'actionDefinitions', error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  });
  workflow.addNode("extract_transitions", async (state, config) => {
    const bus = config?.configurable?.statusBus as GameCreationBus | undefined;
    bus?.emit({ type: 'artifact:started', artifact: 'transitions' });
    try {
      const result = await transitionsSubgraph.invoke(state, config);
      bus?.emit({ type: 'artifact:completed', artifact: 'transitions' });
      return result;
    } catch (err) {
      bus?.emit({ type: 'artifact:error', artifact: 'transitions', error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  });
  workflow.addNode("validate_transitions", validationNode);
  workflow.addNode("repair_transitions", repairTransitionsNode);
  workflow.addNode("extract_instructions", async (state, config) => {
    const bus = config?.configurable?.statusBus as GameCreationBus | undefined;
    bus?.emit({ type: 'artifact:started', artifact: 'instructions' });
    try {
      const result = await instructionsSubgraph.invoke(state, config);
      bus?.emit({ type: 'artifact:completed', artifact: 'instructions' });
      return result;
    } catch (err) {
      bus?.emit({ type: 'artifact:error', artifact: 'instructions', error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  });
  workflow.addNode("repair_artifacts", repairArtifactsNode);
  workflow.addNode("generate_mechanics", async (state, config) => {
    // Thin wrapper: build targets + interfaces, invoke subgraph, map outputs back
    if (!state.stateSchema) {
      console.warn("[generate_mechanics] No stateSchema, skipping");
      return {};
    }

    const fields: GameStateField[] = JSON.parse(state.stateSchema);
    const actionDefinitions = state.actionDefinitions
      ? JSON.parse(state.actionDefinitions).actions
      : [];
    const stateInterfaces = generateStateInterfaces(fields, actionDefinitions);

    // Identify init-phase transition IDs so we can exclude them from mechanic generation.
    // Init transitions run via DIRECT PATH at runtime (stateDelta ops applied directly),
    // so generating mechanic code for them wastes LLM tokens and is never executed.
    const initTransitionIds = new Set<string>();
    if (state.stateTransitions) {
      try {
        const parsed = JSON.parse(state.stateTransitions);
        for (const t of parsed.transitions ?? []) {
          if (t.fromPhase === "init") initTransitionIds.add(t.id);
        }
      } catch { /* ignore parse errors */ }
    }

    const allTargets = buildMechanicTargets(
      state.transitionInstructions || {},
      state.playerPhaseInstructions || {},
    );
    const targets = allTargets.filter(t => !initTransitionIds.has(t.id));
    if (initTransitionIds.size > 0) {
      console.log(`[generate_mechanics] Skipping ${initTransitionIds.size} init-phase transition(s): ${[...initTransitionIds].join(", ")}`);
    }

    if (targets.length === 0) {
      console.debug("[generate_mechanics] No targets with mechanicsGuidance, skipping");
      return {};
    }

    console.debug(
      `[generate_mechanics] Invoking mechanics subgraph for ${targets.length} target(s)`,
    );

    const result = await mechanicsGraph.invoke({
      targets,
      stateInterfaces,
      existingCode: state.generatedMechanics || {},
    }, config);

    return {
      generatedMechanics: result.generatedMechanics,
      mechanicsErrors: result.mechanicsErrors,
    };
  });
  workflow.addNode("repair_mechanics", repairMechanicsNode);
  workflow.addNode("repair_coherence", repairCoherenceNode);
  workflow.addNode("extract_produced_tokens", async (state, config) => {
    const bus = config?.configurable?.statusBus as GameCreationBus | undefined;
    bus?.emit({ type: 'artifact:started', artifact: 'producedTokens' });
    try {
      const result = await producedTokensSubgraph.invoke(state, config);
      bus?.emit({ type: 'artifact:completed', artifact: 'producedTokens' });
      return result;
    } catch (err) {
      bus?.emit({ type: 'artifact:error', artifact: 'producedTokens', error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  });

  // Define flow with validation error checks
  // Route START directly to schema extraction
  // Decide where to start based on any existing artifacts and the atomic regen flag.
  // If schema is missing -> schema. If transitions or instructions missing and
  // `atomicArtifactRegen` is true -> go back to schema to regenerate whole set.
  // Otherwise route to the missing subgraph directly.
  workflow.addConditionalEdges(
    START,
    (state: any) => {
      const atomic = !!state.atomicArtifactRegen;
      const hasSchema = state.stateSchema && state.stateSchema.length > 0;
      const hasActionDefs = state.actionDefinitions && state.actionDefinitions.length > 0;
      const hasTransitions = state.stateTransitions && state.stateTransitions.length > 0;
      const hasPlayerPhaseInstructions = state.playerPhaseInstructions && Object.keys(state.playerPhaseInstructions || {}).length > 0;
      const hasTransitionInstructions = state.transitionInstructions && Object.keys(state.transitionInstructions || {}).length > 0;
      const hasProducedTokens = state.producedTokensConfiguration && state.producedTokensConfiguration.length > 0;

      if (!hasSchema) return "schema";
      if (!hasActionDefs) return atomic ? "schema" : "action_definitions";
      if (!hasTransitions) return atomic ? "schema" : "transitions";
      if (!hasPlayerPhaseInstructions || !hasTransitionInstructions) return atomic ? "schema" : "instructions";
      if (!hasProducedTokens) return atomic ? "schema" : "generate_mechanics";
      return "end";
    },
    {
      schema: "extract_schema" as any,
      action_definitions: "extract_action_definitions" as any,
      transitions: "extract_transitions" as any,
      instructions: "extract_instructions" as any,
      generate_mechanics: "generate_mechanics" as any,
      end: END,
    }
  );
  
  // After schema: check for validation errors, then run action definitions extraction
  workflow.addConditionalEdges(
    "extract_schema" as any,
    (state) => {
      if (state.schemaValidationErrors && state.schemaValidationErrors.length > 0) {
        console.error("[SpecProcessingGraph] Schema extraction failed validation, stopping pipeline");
        return "end";
      }
      return "continue";
    },
    {
      continue: "extract_action_definitions" as any,
      end: END,
    }
  );

  // After action definitions: proceed to transitions
  workflow.addEdge("extract_action_definitions" as any, "extract_transitions" as any);

  workflow.addEdge("extract_transitions" as any, "validate_transitions" as any);
  
  // After transitions validation: repair if errors, otherwise continue
  workflow.addConditionalEdges(
    "validate_transitions" as any,
    (state) => {
      if (state.transitionsValidationErrors && state.transitionsValidationErrors.length > 0) {
        console.warn(`[SpecProcessingGraph] Transitions validation found ${state.transitionsValidationErrors.length} error(s), routing to repair`);
        return "repair";
      }
      return "continue";
    },
    {
      continue: "extract_instructions" as any,
      repair: "repair_transitions" as any,
    }
  );

  // After transitions repair: continue if fixed, stop if still broken
  workflow.addConditionalEdges(
    "repair_transitions" as any,
    (state) => {
      if (state.transitionsValidationErrors && state.transitionsValidationErrors.length > 0) {
        console.error("[SpecProcessingGraph] Transitions repair failed, stopping pipeline");
        return "end";
      }
      return "continue";
    },
    {
      continue: "extract_instructions" as any,
      end: END,
    }
  );
  
  // After instructions: repair if errors, otherwise continue to tokens
  workflow.addConditionalEdges(
    "extract_instructions" as any,
    (state) => {
      if (state.instructionsValidationErrors && state.instructionsValidationErrors.length > 0) {
        console.warn(`[SpecProcessingGraph] Instructions validation found ${state.instructionsValidationErrors.length} error(s), routing to repair`);
        return "repair";
      }
      return "continue";
    },
    {
      continue: "generate_mechanics" as any,
      repair: "repair_artifacts" as any,
    }
  );

  // After artifacts repair: continue if fixed, stop if still broken
  workflow.addConditionalEdges(
    "repair_artifacts" as any,
    (state) => {
      if (state.instructionsValidationErrors && state.instructionsValidationErrors.length > 0) {
        console.error("[SpecProcessingGraph] Artifact repair failed, stopping pipeline");
        return "end";
      }
      return "continue";
    },
    {
      continue: "generate_mechanics" as any,
      end: END,
    }
  );

  // After mechanic generation: repair if tsc errors, otherwise continue to tokens
  workflow.addConditionalEdges(
    "generate_mechanics" as any,
    (state) => {
      if (state.mechanicsErrors && state.mechanicsErrors.length > 0) {
        console.warn(`[SpecProcessingGraph] Mechanics generation found ${state.mechanicsErrors.length} tsc error(s), routing to repair`);
        return "repair";
      }
      return "continue";
    },
    {
      continue: "coherence_check" as any,
      repair: "repair_mechanics" as any,
    }
  );

  // After mechanics repair: continue regardless (best-effort — don't block pipeline)
  workflow.addEdge("repair_mechanics" as any, "coherence_check" as any);

  // Coherence check — runs once after all artifacts + mechanics are finalized
  workflow.addNode("coherence_check", coherenceCheckNode);

  // After coherence check: route to repair if confirmed/probable findings exist
  workflow.addConditionalEdges(
    "coherence_check" as any,
    (state) => {
      const actionable = (state.coherenceFindings?.issues ?? []).filter(
        (i: any) => i.confidence === 'confirmed' || i.confidence === 'probable',
      );
      if (actionable.length > 0) {
        console.warn(`[SpecProcessingGraph] Coherence check found ${actionable.length} actionable finding(s), routing to repair`);
        return "repair";
      }
      return "continue";
    },
    {
      continue: "extract_produced_tokens" as any,
      repair: "repair_coherence" as any,
    }
  );

  // After coherence repair: always continue (best-effort — don't block pipeline)
  workflow.addEdge("repair_coherence" as any, "extract_produced_tokens" as any);

  // After produced tokens: always end
  workflow.addEdge("extract_produced_tokens" as any, END);

  console.log("[SpecProcessingGraph] Graph compiled successfully");
  return workflow.compile({ checkpointer });
}
