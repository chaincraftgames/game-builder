/**
 * Runtime Simulation Graph
 * 
 * Executes game with phase-aware processing:
 * 1. initialize_game - Set up initial state
 * 2. route_phase - Detect phase and select instructions
 * 3. plan_changes - Reason about action effects
 * 4. execute_changes - Format as valid JSON
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { BaseCheckpointSaver } from "@langchain/langgraph";
import { RuntimeState, RuntimeStateType } from "./runtime-state.js";
import { setupSimulationModel } from "#chaincraft/ai/model-config.js";
import { initializeGame } from "./nodes/initialize-game/index.js";
import { routePhase } from "./nodes/route-phase/index.js";
import { planChanges } from "./nodes/plan-changes/index.js";
import { executeChanges } from "./nodes/execute-changes/index.js";

// Max iterations to prevent infinite loops
const MAX_ITERATIONS = 50;

/**
 * Routes from START based on what needs to happen.
 * Expects explicit initialization via initializeSimulation().
 * Auto-initialization removed - spec version updates require reprocessing.
 */
function routeFromStart(state: RuntimeStateType): string | typeof END {
  // If we have an action to process and game is initialized, route to phase routing
  if (state.playerAction && state.isInitialized) {
    return "route_phase";
  }
  
  // If not initialized but has players, this is an initialization call
  if (!state.isInitialized && state.players?.length > 0) {
    return "initialize_game";
  }
  
  // Otherwise just return current state
  return END;
}

/**
 * Routes after phase detection based on what needs processing.
 * Priority: automatic transitions > player actions > wait for input
 */
function routeAfterPhaseDetection(state: RuntimeStateType): string | typeof END {
  // Safety check: prevent infinite loops
  const iterations = (state as any)._iterations || 0;
  if (iterations >= MAX_ITERATIONS) {
    console.warn(`[RuntimeGraph] Max iterations (${MAX_ITERATIONS}) reached, ending execution`);
    return END;
  }
  
  // If automatic transition ready, process it first
  if (state.transitionReady && state.nextPhase) {
    console.debug(`[RuntimeGraph] Routing to plan automatic transition: ${state.currentPhase} → ${state.nextPhase}`);
    return "plan_changes";
  }
  
  // If player action exists, process it
  if (state.playerAction) {
    console.debug(`[RuntimeGraph] Routing to plan player action: ${state.playerAction.playerId}`);
    return "plan_changes";
  }
  
  // If phase requires player input and no action, wait (END)
  if (state.requiresPlayerInput) {
    console.debug(`[RuntimeGraph] Phase requires input, waiting for player action`);
    return END;
  }
  
  // No action or transition, end
  console.debug(`[RuntimeGraph] No action or transition to process`);
  return END;
}

/**
 * Routes after executing changes - ALWAYS loops back to route_phase to re-evaluate.
 * route_phase will determine if we should continue processing or END.
 * 
 * This ensures:
 * 1. Phase changes trigger immediate re-evaluation
 * 2. Cascading automatic transitions work
 * 3. We stop when route_phase determines no more work needed
 */
function routeAfterExecution(state: RuntimeStateType): string {
  // Safety check: prevent infinite loops
  const iterations = (state as any)._iterations || 0;
  if (iterations >= MAX_ITERATIONS) {
    console.warn(`[RuntimeGraph] Max iterations (${MAX_ITERATIONS}) reached, ending execution`);
    return END as any;
  }
  
  // Always loop back to route_phase - it will decide if we continue or END
  console.debug(`[RuntimeGraph] Looping to route_phase for re-evaluation`);
  return "route_phase";
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
  
  // Setup model (using fast simulation model)
  const model = await setupSimulationModel();
  
  // Create nodes
  const initNode = initializeGame(model);
  const routeNode = routePhase(model);
  const planNode = planChanges(model);
  const executeNode = executeChanges(model);
  
  // Wrap route_phase to track iterations
  const routeNodeWithCounter = async (state: RuntimeStateType) => {
    const iterations = ((state as any)._iterations || 0) + 1;
    console.debug(`[RuntimeGraph] Iteration ${iterations}/${MAX_ITERATIONS}`);
    const result = await routeNode(state);
    return { ...result, _iterations: iterations };
  };
  
  // Add nodes to graph
  workflow.addNode("initialize_game", initNode);
  workflow.addNode("route_phase", routeNodeWithCounter as any);
  workflow.addNode("plan_changes", planNode);
  workflow.addNode("execute_changes", executeNode);
  
  // Define edges
  workflow.addConditionalEdges(START, routeFromStart as any);
  workflow.addEdge("initialize_game" as any, "route_phase" as any);
  workflow.addConditionalEdges("route_phase" as any, routeAfterPhaseDetection as any);
  workflow.addEdge("plan_changes" as any, "execute_changes" as any);
  workflow.addConditionalEdges("execute_changes" as any, routeAfterExecution as any);
  
  console.log("[RuntimeGraph] Graph compiled successfully");
  console.log(`[RuntimeGraph] Model: ${model.modelName}`);
  
  return workflow.compile({ 
    checkpointer,
    // Track iterations to prevent infinite loops
    interruptBefore: [],
  });
}
