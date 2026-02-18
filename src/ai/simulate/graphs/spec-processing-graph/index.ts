/**
 * Spec Processing Graph
 *
 * Transforms game specification into runtime artifacts:
 * 1. extract_schema - Generate state schema
 * 2. extract_transitions - Identify phase transitions
 * 3. extract_instructions - Create phase-specific instructions
 * 4. extract_produced_tokens - Identify persistent tokens to produce
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { BaseCheckpointSaver } from "@langchain/langgraph";
import { SpecProcessingState } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/spec-processing-state.js";
import { schemaExtractionConfig } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-schema/index.js";
import { transitionsExtractionConfig } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-transitions/index.js";
import { instructionsExtractionConfig } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-instructions/index.js";
import { producedTokensExtractionConfig } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-produced-tokens/index.js";
import { createValidationNode } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/validate-transitions/index.js";
import { createExtractionSubgraph } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/node-factories.js";

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
  const transitionsSubgraph = createExtractionSubgraph(transitionsExtractionConfig);
  const instructionsSubgraph = createExtractionSubgraph(instructionsExtractionConfig);
  const producedTokensSubgraph = createExtractionSubgraph(producedTokensExtractionConfig);

  // Create validation node for transitions
  const validationNode = createValidationNode();

  // Add nodes to graph - subgraphs need to receive config with store
  workflow.addNode("extract_schema", async (state, config) => {
    const result = await schemaSubgraph.invoke(state, config);
    return result;
  });
  workflow.addNode("extract_transitions", async (state, config) => {
    const result = await transitionsSubgraph.invoke(state, config);
    return result;
  });
  workflow.addNode("validate_transitions", validationNode);
  workflow.addNode("extract_instructions", async (state, config) => {
    const result = await instructionsSubgraph.invoke(state, config);
    return result;
  });
  workflow.addNode("extract_produced_tokens", async (state, config) => {
    const result = await producedTokensSubgraph.invoke(state, config);
    return result;
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
      const hasTransitions = state.stateTransitions && state.stateTransitions.length > 0;
      const hasPlayerPhaseInstructions = state.playerPhaseInstructions && Object.keys(state.playerPhaseInstructions || {}).length > 0;
      const hasTransitionInstructions = state.transitionInstructions && Object.keys(state.transitionInstructions || {}).length > 0;
      const hasProducedTokens = state.producedTokensConfiguration && state.producedTokensConfiguration.length > 0;

      if (!hasSchema) return "schema";
      if (!hasTransitions) return atomic ? "schema" : "transitions";
      if (!hasPlayerPhaseInstructions || !hasTransitionInstructions) return atomic ? "schema" : "instructions";
      if (!hasProducedTokens) return atomic ? "schema" : "produced_tokens";
      return "end";
    },
    {
      schema: "extract_schema" as any,
      transitions: "extract_transitions" as any,
      instructions: "extract_instructions" as any,
      produced_tokens: "extract_produced_tokens" as any,
      end: END,
    }
  );
  
  // After schema: check for validation errors before continuing
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
      continue: "extract_transitions" as any,
      end: END,
    }
  );
  
  workflow.addEdge("extract_transitions" as any, "validate_transitions" as any);
  
  // After transitions validation: check for errors before continuing
  workflow.addConditionalEdges(
    "validate_transitions" as any,
    (state) => {
      if (state.transitionsValidationErrors && state.transitionsValidationErrors.length > 0) {
        console.error("[SpecProcessingGraph] Transitions extraction failed validation, stopping pipeline");
        return "end";
      }
      return "continue";
    },
    {
      continue: "extract_instructions" as any,
      end: END,
    }
  );
  
  // After instructions: check for errors before continuing to tokens
  workflow.addConditionalEdges(
    "extract_instructions" as any,
    (state) => {
      if (state.instructionsValidationErrors && state.instructionsValidationErrors.length > 0) {
        console.error("[SpecProcessingGraph] Instructions extraction failed validation, stopping pipeline");
        return "end";
      }
      return "continue";
    },
    {
      continue: "extract_produced_tokens" as any,
      end: END,
    }
  );
  
  // After produced tokens: always end
  workflow.addEdge("extract_produced_tokens" as any, END);

  console.log("[SpecProcessingGraph] Graph compiled successfully");
  return workflow.compile({ checkpointer });
}
