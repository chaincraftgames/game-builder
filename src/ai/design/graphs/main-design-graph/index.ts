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
import { GameDesignState } from "../../game-design-state.js";
import { BaseCheckpointSaver } from "@langchain/langgraph";
import { setupSpecPlanModel, setupSpecExecuteModel, setupModel } from "../../../model-config.js";
import { createSpecPlan } from "./nodes/spec-plan/index.js";
import { createSpecExecute } from "./nodes/spec-execute/index.js";
import { createConversationalAgent } from "./nodes/conversational-agent/index.js";
import { diffSpec } from "./nodes/diff-spec/index.js";

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
  const conversationalModel = await setupModel();
  const specPlanModel = await setupSpecPlanModel();
  const specExecuteModel = await setupSpecExecuteModel();
  
  // Create nodes
  const conversationalAgent = await createConversationalAgent(
    conversationalModel,
    constraintsRegistry,
    mechanicsRegistry
  );
  const specPlan = createSpecPlan(specPlanModel);
  const specExecute = createSpecExecute(specExecuteModel);
  
  // Add all nodes to graph
  workflow.addNode("conversation", conversationalAgent);
  workflow.addNode("plan_spec", specPlan);
  workflow.addNode("execute_spec", specExecute);
  workflow.addNode("generate_diff", diffSpec);
  
  // TODO: Metadata subgraph invocation
  // workflow.addNode("update_metadata", async (state) => {
  //   const metadataSubgraph = await createMetadataSubgraph();
  //   const result = await metadataSubgraph.invoke(state);
  //   return result;
  // });
  
  // Define edges (using 'as any' to work around LangGraph's strict typing)
  workflow.addEdge(START, "conversation" as any);
  workflow.addConditionalEdges("conversation" as any, routeFromConversation as any);
  workflow.addEdge("plan_spec" as any, "execute_spec" as any);
  workflow.addEdge("execute_spec" as any, "generate_diff" as any);
  workflow.addConditionalEdges("generate_diff" as any, routeAfterSpecDiff as any);
  // workflow.addEdge("update_metadata" as any, END);
  
  console.log("[MainDesignGraph] Graph compiled successfully");
  console.log(`[MainDesignGraph] Models - conversation: ${conversationalModel.modelName}, spec-plan: ${specPlanModel.modelName}, spec-execute: ${specExecuteModel.modelName}`);
  
  return workflow.compile({ checkpointer });
}

// TODO: Export compiled graph once implemented
// export const graph = await createMainDesignGraph(null as any, "");
// graph.name = "Main Design Graph";
