/**
 * Spec Processing Graph
 *
 * Transforms game specification into runtime artifacts:
 * 1. extract_schema - Generate state schema
 * 2. extract_transitions - Identify phase transitions
 * 3. generate_instructions - Create phase-specific instructions
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { BaseCheckpointSaver } from "@langchain/langgraph";
import { SpecProcessingState } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/spec-processing-state.js";
import { schemaExtractionConfig } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-schema/index.js";
import { transitionsExtractionConfig } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-transitions/index.js";
import { instructionsExtractionConfig } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-instructions/index.js";
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

  // Define flow with validation error checks
  workflow.addEdge(START, "extract_schema" as any);
  
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
  
  // After instructions: always end
  workflow.addEdge("extract_instructions" as any, END);

  console.log("[SpecProcessingGraph] Graph compiled successfully");
  console.log(`[SpecProcessingGraph] Using NodeConfig-based subgraphs for all extraction nodes`);

  return workflow.compile({ checkpointer });
}
