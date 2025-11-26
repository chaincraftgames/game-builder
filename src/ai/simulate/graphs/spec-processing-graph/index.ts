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
import { SpecProcessingState } from "./spec-processing-state.js";
import { setupSpecProcessingModel, setupSpecTransitionsModel } from "#chaincraft/ai/model-config.js";
import { extractSchema } from "./nodes/extract-schema/index.js";
import { extractTransitions } from "./nodes/extract-transitions/index.js";
import { generateInstructions } from "./nodes/generate-instructions/index.js";

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
  
  // Setup models - Sonnet for schema (complex reasoning), Haiku for transitions and instructions
  const schemaModel = await setupSpecProcessingModel();
  const transitionsModel = await setupSpecTransitionsModel();
  const instructionsModel = await setupSpecTransitionsModel(); // Use Haiku 4.5 for fast instruction generation
  
  // Create nodes
  const schemaNode = extractSchema(schemaModel);
  const transitionsNode = extractTransitions(transitionsModel);
  const instructionsNode = generateInstructions(instructionsModel);
  
  // Add nodes to graph
  workflow.addNode("extract_schema", schemaNode);
  workflow.addNode("extract_transitions", transitionsNode);
  workflow.addNode("generate_instructions", instructionsNode);
  
  // Define linear flow: START → schema → transitions → instructions → END
  workflow.addEdge(START, "extract_schema" as any);
  workflow.addEdge("extract_schema" as any, "extract_transitions" as any);
  workflow.addEdge("extract_transitions" as any, "generate_instructions" as any);
  workflow.addEdge("generate_instructions" as any, END);
  
  console.log("[SpecProcessingGraph] Graph compiled successfully");
  console.log(`[SpecProcessingGraph] Schema model: ${schemaModel.modelName}`);
  console.log(`[SpecProcessingGraph] Transitions model: ${transitionsModel.modelName}`);
  console.log(`[SpecProcessingGraph] Instructions model: ${instructionsModel.modelName}`);
  
  return workflow.compile({ checkpointer });
}
