/**
 * Game Test Executor
 * 
 * Executes a single game test scenario against the simulation workflow.
 */

import type { GameTest, Scenario, TestResult, FailurePhase } from "./types.js";
import { createSimulation, initializeSimulation, processAction, getGameState } from "#chaincraft/ai/simulate/simulate-workflow.js";

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
    
    // Step 3: Initialize simulation
    console.log(`[${test.name}] Starting simulation...`);
    const { publicMessage, playerStates } = await initializeSimulation(testGameId, playerIds);
    
    // Track game state
    let gameEnded = false;
    let finalPlayerStates = playerStates;
    let finalGameState: { game: any; players: any } | undefined;
    
    // Step 4: Execute player actions
    for (const action of scenario.playerActions) {
      console.log(`[${test.name}] Executing action: ${action.playerId} - ${action.actionType}`);
      result.turns++;
      
      // Process action through simulation workflow
      const response = await processAction(
        testGameId,
        action.playerId,
        JSON.stringify(action.actionData)
      );
      
      // Update tracking
      gameEnded = response.gameEnded || false;
      finalPlayerStates = response.playerStates;
      
      // Retrieve full game state for assertions
      finalGameState = await getGameState(testGameId);
      
      console.log(`[${test.name}] Response: ${response.publicMessage || 'no message'}`);
      
      // If game ended early, stop processing actions
      // This is valid behavior (e.g., player death in survival games)
      if (gameEnded) {
        console.log(`[${test.name}] Game ended after turn ${result.turns}`);
        break;
      }
    }
    
    result.simulationCompleted = true;
    result.finalState = { playerStates: finalPlayerStates, gameEnded, gameState: finalGameState };
    
    // Step 5: Validate expected outcome
    const outcomeValid = validateOutcome(gameEnded, scenario.expectedOutcome);
    if (!outcomeValid.valid) {
      result.simulationError = outcomeValid.error;
      result.duration = Date.now() - startTime;
      return result;
    }
    
    // Step 6: Run assertions
    console.log(`[${test.name}] Running assertions...`);
    if (!finalGameState) {
      result.simulationError = "No game state available for assertions";
      result.duration = Date.now() - startTime;
      return result;
    }
    
    for (const assertion of scenario.assertions) {
      const assertionResult = assertion(finalGameState);
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
  // Pass spec as optional third parameter for testing
  const result = await createSimulation(gameId, 1, spec);
  return result;
}

/**
 * Validate generated artifacts
 */
function validateArtifacts(artifacts: any): { valid: boolean; errors?: string[] } {
  // For now just check that artifacts exist
  if (!artifacts) {
    return { valid: false, errors: ["No artifacts generated"] };
  }
  return { valid: true };
}

function isLastAction(action: any, scenario: Scenario): boolean {
  return scenario.playerActions[scenario.playerActions.length - 1] === action;
}

function validateOutcome(gameEnded: boolean, expected: any): { valid: boolean; error?: string } {
  if (expected.gameEnded !== undefined && gameEnded !== expected.gameEnded) {
    return {
      valid: false,
      error: `Expected gameEnded=${expected.gameEnded}, got ${gameEnded}`
    };
  }
  
  return { valid: true };
}
