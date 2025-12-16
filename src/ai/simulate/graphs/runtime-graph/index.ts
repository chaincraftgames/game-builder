/**
 * Runtime Simulation Graph
 * 
 * Executes game with deterministic routing and LLM-driven state changes:
 * 1. router - Deterministic routing: evaluates transitions, selects instructions
 * 2. execute_changes - LLM applies instructions to update state
 * 
 * Flow:
 * - START → router (handles initialization via initialize_game transition)
 * - router → execute_changes (if transitionReady=true)
 * - router → END (if requiresPlayerInput=true or game ended)
 * - execute_changes → router (re-evaluate after state change)
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { BaseCheckpointSaver } from "@langchain/langgraph";
import { RuntimeState, RuntimeStateType } from "./runtime-state.js";
import { setupSimulationModel } from "#chaincraft/ai/model-config.js";
import { router } from "./nodes/router/index.js";
import { executeChanges } from "./nodes/execute-changes/index.js";

// Max iterations to prevent infinite loops
const MAX_ITERATIONS = 20;

/**
 * Routes from START based on what needs to happen.
 * Protects router from being invoked in artifact-storage-only mode.
 * Router handles both initialization and gameplay routing when invoked.
 */
function routeFromStart(state: RuntimeStateType): string | typeof END {
  // If we have an action to process and game is initialized, route to router
  if (state.playerAction && state.isInitialized) {
    console.debug('[RuntimeGraph] Routing to router for player action');
    return "router";
  }
  
  // If not initialized but has players, this is an initialization call
  if (!state.isInitialized && state.players?.length > 0) {
    console.debug('[RuntimeGraph] Routing to router for initialization');
    return "router";
  }
  
  // Otherwise just store state and return (artifact storage mode)
  console.debug('[RuntimeGraph] Artifact storage mode, routing to END');
  return END;
}

/**
 * Routes after router decision.
 * Router determines if transition ready or waiting for player input.
 */
function routeAfterRouter(state: RuntimeStateType): string | typeof END {
  // Safety check: prevent infinite loops
  const iterations = (state as any)._iterations || 0;
  if (iterations >= MAX_ITERATIONS) {
    console.warn(`[RuntimeGraph] Max iterations (${MAX_ITERATIONS}) reached, ending execution`);
    return END;
  }
  
  // If transition ready (automatic or from player action), execute it
  if (state.transitionReady) {
    console.debug(`[RuntimeGraph] Router says transition ready, routing to execute_changes`);
    return "execute_changes";
  }
  
  // If requires player input, wait for it
  if (state.requiresPlayerInput) {
    console.debug(`[RuntimeGraph] Router says waiting for player input`);
    return END;
  }
  
  // No transition and no input required - game ended or deadlock (router handles error)
  console.debug(`[RuntimeGraph] Router says no more work needed`);
  return END;
}

/**
 * Routes after executing changes - ALWAYS loops back to router to re-evaluate.
 * Router will determine if we should continue processing or END.
 * 
 * This ensures:
 * 1. Phase changes trigger immediate re-evaluation
 * 2. Cascading automatic transitions work
 * 3. We stop when router determines no more work needed
 */
function routeAfterExecution(state: RuntimeStateType): string {
  // Safety check: prevent infinite loops
  const iterations = (state as any)._iterations || 0;
  if (iterations >= MAX_ITERATIONS) {
    console.warn(`[RuntimeGraph] Max iterations (${MAX_ITERATIONS}) reached, ending execution`);
    return END as any;
  }
  
  // Always loop back to router - it will decide if we continue or END
  console.debug(`[RuntimeGraph] Looping to router for re-evaluation`);
  return "router";
}

/**
 * Creates and compiles the runtime simulation graph.
 * Handles game initialization and action processing with phase routing.
 * 
 * @param checkpointer - Checkpoint saver for state persistence
 * @returns Compiled graph
 */
export async function createRuntimeGraph(
  checkpointer: BaseCheckpointSaver
) {
  const workflow = new StateGraph(RuntimeState);
  
  // Setup model (using fast simulation model for LLM-driven nodes)
  const model = await setupSimulationModel();
  
  // Create nodes
  const routerNode = router(); // Deterministic, no LLM
  const executeNode = executeChanges(model); // LLM-driven execution
  
  // Wrap router to track iterations
  const routerNodeWithCounter = async (state: RuntimeStateType) => {
    const iterations = ((state as any)._iterations || 0) + 1;
    console.debug(`[RuntimeGraph] Iteration ${iterations}/${MAX_ITERATIONS}`);
    const result = await routerNode(state);
    return { ...result, _iterations: iterations };
  };
  
  // Add nodes to graph
  workflow.addNode("router", routerNodeWithCounter as any);
  workflow.addNode("execute_changes", executeNode);
  
  // Define edges
  workflow.addConditionalEdges(START, routeFromStart as any);
  workflow.addConditionalEdges("router" as any, routeAfterRouter as any);
  workflow.addConditionalEdges("execute_changes" as any, routeAfterExecution as any);
  
  console.log("[RuntimeGraph] Graph compiled successfully");
  console.log(`[RuntimeGraph] Model: ${model.modelName}`);
  
  return workflow.compile({ 
    checkpointer,
    // Track iterations to prevent infinite loops
    interruptBefore: [],
  });
}
