/**
 * Game Test Executor
 * 
 * Executes a single game test scenario against the simulation workflow.
 */

import type { GameTest, Scenario, TestResult, FailurePhase } from "./types.js";
import { createSimulation, initializeSimulation, processAction } from "#chaincraft/ai/simulate/simulate-workflow.js";

/**
 * Execute a single game test scenario
 * 
 * @param test The game test containing spec and scenarios
 * @param scenario The specific scenario to run
 * @param gameId Optional game ID - if provided, reuses existing artifacts. If not provided, generates new artifacts.
 */
export async function executeGameTest(
  test: GameTest,
  scenario: Scenario,
  gameId?: string
): Promise<TestResult> {
  const startTime = Date.now();
  
  const result: TestResult = {
    testName: test.name,
    scenarioName: scenario.name,
    passed: false,
    duration: 0,
    artifactsGenerated: false,
    simulationCompleted: false,
    turns: 0,
    assertionResults: [],
  };
  
  try {
    // Use provided gameId or generate a new one
    const testGameId = gameId || `test-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    // Step 1: Generate artifacts from spec (or reuse if gameId was provided)
    console.log(`[${test.name}] ${gameId ? 'Using existing' : 'Generating'} artifacts...`);
    const artifacts = await generateArtifacts(test.spec, testGameId);
    result.artifactsGenerated = true;
    
    // Step 2: Validate artifacts
    const validation = validateArtifacts(artifacts);
    if (!validation.valid) {
      result.artifactErrors = validation.errors;
      result.duration = Date.now() - startTime;
      return result;
    }
    
    // Extract player IDs from scenario actions
    const playerIds = [...new Set(scenario.playerActions.map(a => a.playerId))];
    
    const { publicMessage, playerStates } = await initializeSimulation(testGameId, playerIds);
    
    const simulation = {
      gameId: testGameId,
      state: { 
        game: { gameEnded: false, currentPhase: "playing" },
        players: Object.fromEntries(playerStates.entries())
      },
      playerStates
    }
    // Step 3: Initialize simulation
    console.log(`[${test.name}] Starting simulation...`);
    const simulation = await initializeSimulation(artifacts);
    
    // Step 4: Execute player actions
    for (const action of scenario.playerActions) {
      console.log(`[${test.name}] Executing action: ${action.actionType}`);
      
      // Handle special action types
      const resolvedAction = await resolveAction(action, artifacts, simulation.state);
      
      await executeAction(simulation, resolvedAction);
      result.turns++;
      
      // Check for unexpected game end
      if (simulation.state.game.gameEnded && !isLastAction(action, scenario)) {
        result.simulationError = "Game ended prematurely";
        result.finalState = simulation.state;
        result.duration = Date.now() - startTime;
        return result;
      }
    }
    
    result.simulationCompleted = true;
    result.finalState = simulation.state;
    
    // Step 5: Validate expected outcome
    const outcomeValid = validateOutcome(simulation.state, scenario.expectedOutcome);
    if (!outcomeValid.valid) {
      result.simulationError = outcomeValid.error;
      result.duration = Date.now() - startTime;
      return result;
    }
    
    // Step 6: Run assertions
    console.log(`[${test.name}] Running assertions...`);
    for (const assertion of scenario.assertions) {
      const assertionResult = assertion(simulation.state);
      result.assertionResults.push(assertionResult);
    }
    
    // Test passes if all assertions pass
    result.passed = result.assertionResults.every(a => a.passed);
    
  } catch (error) {
    result.simulationError = error instanceof Error ? error.message : String(error);
  }
  
  result.duration = Date.now() - startTime;
  return result;
}

/**
 * Generate artifacts from game specification
 */
async function generateArtifacts(spec: string, gameId: string): Promise<any> {
  // Use createSimulation which calls spec-processing-graph
  const result = await createSimulation(gameId, spec, 1);
  return result;
}

/**
 * Validate generated artifacts
 */
function validateArtifacts(artifacts: any): { valid: boolean; errors?: string[] } {
  // TODO: Implement artifact validation
  return { valid: true };
}

/**
 * Initialize simulation with artifacts
 * TODO: Integrate with simulation workflow
 */
async function initializeSimulation(artifacts: any): Promise<any> {
  // TODO: Initialize LangGraph simulation workflow
  throw new Error("Not implemented - integrate with simulation workflow");
}

/**
 * Resolve special action types (selectSafeOption, etc.)
 */
async function resolveAction(
  action: any,
  artifacts: any,
  currentState: any
): Promise<any> {
  // Handle special action types
  switch (action.actionType) {
    case "selectSafeOption":
      // Query artifacts to find a safe option
      return resolveSafeOption(action, artifacts, currentState);
    
    case "selectDeadlyOption":
      // Query artifacts to find the deadly option
      return resolveDeadlyOption(action, artifacts, currentState);
    
    case "awaitAutomaticPhase":
      // No action needed, just wait for phase transition
      return { type: "wait" };
    
    default:
  const { publicMessage, playerStates, gameEnded } = await processAction(
    simulation.gameId,
    action.playerId,
    action.actionData.move || action.actionData
  );
  
  // Update simulation state
  simulation.state.game.gameEnded = gameEnded;
  simulation.state.players = Object.fromEntries(playerStates.entries());
  simulation.playerStates = playerStates
  }
}

function resolveSafeOption(action: any, artifacts: any, state: any): any {
  // TODO: Query artifacts to find safe option for current round
  throw new Error("Not implemented");
}

function resolveDeadlyOption(action: any, artifacts: any, state: any): any {
  // TODO: Query artifacts to find deadly option for current round
  throw new Error("Not implemented");
}

async function executeAction(simulation: any, action: any): Promise<void> {
  // TODO: Send action to simulation workflow
  throw new Error("Not implemented");
}

function isLastAction(action: any, scenario: Scenario): boolean {
  return scenario.playerActions[scenario.playerActions.length - 1] === action;
}

function validateOutcome(state: any, expected: any): { valid: boolean; error?: string } {
  if (expected.gameEnded !== undefined && state.game.gameEnded !== expected.gameEnded) {
    return {
      valid: false,
      error: `Expected gameEnded=${expected.gameEnded}, got ${state.game.gameEnded}`
    };
  }
  
  if (expected.finalPhase && state.game.currentPhase !== expected.finalPhase) {
    return {
      valid: false,
      error: `Expected phase=${expected.finalPhase}, got ${state.game.currentPhase}`
    };
  }
  
  // TODO: Validate winner if specified
  
  return { valid: true };
}
