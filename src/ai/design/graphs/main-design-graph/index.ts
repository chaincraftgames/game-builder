/**
 * Main Design Graph
 * 
 * Orchestrates the conversational design workflow:
 * 1. Conversational agent (routes to spec/metadata updates via flags)
 * 2. Spec update flow (plan → execute → diff)
 * 3. Metadata subgraph invocation (TODO)
 * 
 * Returns state with diffs (specDiff/metadataDiff) for API response.
 * Client layers (REST API, Discord bot, web UI) handle formatting.
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { GameDesignState, getConsolidationThresholds } from "#chaincraft/ai/design/game-design-state.js";
import { BaseCheckpointSaver } from "@langchain/langgraph";
import { setupSpecPlanModel, setupSpecExecuteModel, setupModel, setupConversationalAgentModel, setupNarrativeModel } from "#chaincraft/ai/model-config.js";
import { createSpecPlan } from "#chaincraft/ai/design/graphs/main-design-graph/nodes/spec-plan/index.js";
import { createSpecExecute } from "./nodes/spec-execute/index.js";
import { createConversationalAgent } from "#chaincraft/ai/design/graphs/main-design-graph/nodes/conversational-agent/index.js";
import { createGenerateNarratives } from "./nodes/generate-narratives/index.js";
import { specDiff } from "#chaincraft/ai/design/graphs/main-design-graph/nodes/spec-diff/index.js";

// Import metadata subgraph (TODO: Implement)
// import { createMetadataSubgraph } from "../gamepiece-metadata-subgraph/index.js";

/**
 * Routes from conversational agent based on flags set by the agent.
 * Spec updates take priority over metadata updates.
 * 
 * @param state - Current graph state
 * @returns Next node to execute
 */
function routeFromConversation(
  state: typeof GameDesignState.State
): "plan_spec" | typeof END {
  if (state.specUpdateNeeded) {
    return "plan_spec";
  } 
  // TODO: Re-enable when metadata subgraph is implemented
  // else if (state.metadataUpdateNeeded) {
  //   return "update_metadata";
  // }
  else {
    return END;
  }
}

function routeFromSpecPlan(state: typeof GameDesignState.State): 
  "execute_spec" | typeof END {
  const accumulated = state.pendingSpecChanges || [];
  const { planThreshold, charThreshold } = getConsolidationThresholds(state);
  
  console.log(`[router] Thresholds: ${planThreshold} plans, ${charThreshold} chars`);
  console.log(`[router] Current: ${accumulated.length} plans, ${accumulated.reduce((sum, plan) => sum + plan.changes.length, 0)} chars`);
  
  // Always generate initial spec immediately (no existing spec to update)
  if (!state.currentSpec) {
    console.log('[router] Initial spec - generating immediately');
    return "execute_spec";
  }
  
  if (state.forceSpecGeneration) {
    console.log('[router] Force flag set - generating immediately');
    return "execute_spec";
  }
  
  if (accumulated.length >= planThreshold) {
    console.log(`[router] Auto-consolidate: ${accumulated.length}/${planThreshold} plans`);
    return "execute_spec";
  }
  
  const totalChars = accumulated.reduce((sum, plan) => sum + plan.changes.length, 0);
  if (totalChars >= charThreshold) {
    console.log(`[router] Auto-consolidate: ${totalChars}/${charThreshold} chars`);
    return "execute_spec";
  }
  
  console.log(`[router] Accumulating - below thresholds`);
  return END; // Accumulate changes for later consolidation
}

/**
 * Routes after spec execution.
 * If there are narrative markers to generate, route to generate_narratives.
 * Otherwise, proceed to generate_diff.
 * 
 * @param state - Current graph state
 * @returns Next node to execute
 */
function routeFromSpecExecute(
  state: typeof GameDesignState.State
): "generate_narratives" | "generate_diff" {
  const markersToUpdate = state.narrativesNeedingUpdate || [];
  
  if (markersToUpdate.length > 0) {
    console.log(`[router] ${markersToUpdate.length} narrative markers found - generating narratives`);
    return "generate_narratives";
  }
  
  console.log('[router] No narrative markers - skipping narrative generation');
  return "generate_diff";
}

/**
 * Routes after spec diff generation.
 * If metadata also needs update, route there. Otherwise we're done.
 * 
 * @param state - Current graph state
 * @returns Next node to execute or END
 */
function routeAfterSpecDiff(
  state: typeof GameDesignState.State
): typeof END {
  // TODO: Re-enable when metadata subgraph is implemented
  // return state.metadataUpdateNeeded ? "update_metadata" : END;
  return END;
}

/**
 * Creates and compiles the main design workflow graph.
 * 
 * @param checkpointer - Checkpoint saver for state persistence
 * @param constraintsRegistry - Game design constraints
 * @param mechanicsRegistry - Available game mechanics
 * @returns Compiled graph
 */
export async function createMainDesignGraph(
  checkpointer: BaseCheckpointSaver,
  constraintsRegistry: string,
  mechanicsRegistry: string = "No specific mechanics registry provided."
) {
  const workflow = new StateGraph(GameDesignState);
  
  // Setup models
  const conversationalModel = await setupConversationalAgentModel();
  const specPlanModel = await setupSpecPlanModel();
  const specExecuteModel = await setupSpecExecuteModel();
  const narrativeModel = await setupNarrativeModel();
  
  // Create nodes
  const conversationalAgent = await createConversationalAgent(
    conversationalModel,
    constraintsRegistry,
    mechanicsRegistry
  );
  const specPlan = createSpecPlan(specPlanModel);
  const specExecute = createSpecExecute(specExecuteModel);
  const generateNarratives = createGenerateNarratives(narrativeModel);
  
  // Add all nodes to graph
  workflow.addNode("conversation", conversationalAgent);
  workflow.addNode("plan_spec", specPlan);
  workflow.addNode("execute_spec", specExecute);
  workflow.addNode("generate_narratives", generateNarratives);
  workflow.addNode("generate_diff", specDiff);
  
  // TODO: Metadata subgraph invocation
  // workflow.addNode("update_metadata", async (state) => {
  //   const metadataSubgraph = await createMetadataSubgraph();
  //   const result = await metadataSubgraph.invoke(state);
  //   return result;
  // });
  
  // Define edges (using 'as any' to work around LangGraph's strict typing)
  workflow.addEdge(START, "conversation" as any);
  workflow.addConditionalEdges("conversation" as any, routeFromConversation as any);
  workflow.addConditionalEdges("plan_spec" as any, routeFromSpecPlan as any);
  workflow.addConditionalEdges("execute_spec" as any, routeFromSpecExecute as any);
  workflow.addEdge("generate_narratives" as any, "generate_diff" as any);
  workflow.addConditionalEdges("generate_diff" as any, routeAfterSpecDiff as any);
  // workflow.addEdge("update_metadata" as any, END);
  
  console.log("[MainDesignGraph] Graph compiled successfully");
  console.log(`[MainDesignGraph] Models - conversation: ${conversationalModel.modelName}, spec-plan: ${specPlanModel.modelName}, spec-execute: ${specExecuteModel.modelName}, narrative: ${narrativeModel.modelName}`);
  
  return workflow.compile({ checkpointer });
}

// TODO: Export compiled graph once implemented
// export const graph = await createMainDesignGraph(null as any, "");
// graph.name = "Main Design Graph";
