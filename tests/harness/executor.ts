/**
 * Game Test Executor
 * 
 * Executes a single game test scenario against the simulation workflow.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ESM-safe __filename and __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import type { GameTest, Scenario, TestResult, FailurePhase } from "./types.js";
import { createSimulation, initializeSimulation, processAction, getGameState } from "#chaincraft/ai/simulate/simulate-workflow.js";
import { injectPreGeneratedArtifacts, type SpecArtifacts, extractSpecNarratives } from "./helpers.js";

/**
 * Execute a single game test scenario
 * 
 * @param test The game test containing spec and scenarios
 * @param scenario The specific scenario to run
 * @param gameId Optional game ID - if provided, reuses existing artifacts. If not provided, generates new artifacts.
 * @param testFileDir Optional directory of the test file (for resolving relative artifact paths)
 */
export async function executeGameTest(
  test: GameTest,
  scenario: Scenario,
  gameId?: string,
  testFileDir?: string
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
    // Generate a unique session ID for each test run to avoid using cached data
    const sessionId = `test-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    // Generate unique gameId if not provided (for artifact cache isolation)
    // If gameId IS provided, reuse existing artifacts from that gameId
    const testGameId = gameId || `test-game-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    // Step 1: Check if test specifies pre-generated artifacts
    if (test.artifactsFile) {
      console.log(`[${test.name}] Loading pre-generated artifacts from: ${test.artifactsFile}`);
      
      // Resolve artifact file path relative to test file
      const artifactPath = testFileDir 
        ? resolve(testFileDir, test.artifactsFile)
        : resolve(test.artifactsFile);
      
      try {
        const artifactsJson = readFileSync(artifactPath, 'utf-8');
        const artifacts: SpecArtifacts = JSON.parse(artifactsJson);
        
        console.log(`[${test.name}] Pre-generated artifacts loaded successfully`);
        
        // Pass artifacts directly to createSimulation
        await createSimulation(sessionId, testGameId, 1, {
          preGeneratedArtifacts: artifacts
        });
        result.artifactsGenerated = true;
        
      } catch (error) {
        result.artifactErrors = [
          `Failed to load artifacts from ${test.artifactsFile}: ${error instanceof Error ? error.message : String(error)}`
        ];
        result.duration = Date.now() - startTime;
        return result;
      }
    } else {
      // Step 1: Generate artifacts from spec (or reuse if gameId was provided)
      console.log(`[${test.name}] ${gameId ? 'Using existing' : 'Generating'} artifacts...`);
      
      // Try to load narratives JSON file if test specifies one
      let specNarrativesOverride: Record<string, string> | undefined;
      if (test.narrativesFile) {
        const specDir = testFileDir || __dirname;
        const narrativesPath = resolve(specDir, test.narrativesFile);
        
        try {
          const narrativesJson = readFileSync(narrativesPath, 'utf-8');
          specNarrativesOverride = JSON.parse(narrativesJson);
          console.log(`[${test.name}] Loaded narratives from: ${test.narrativesFile}`);
        } catch (error) {
          const msg = `[${test.name}] Failed to load narratives from ${test.narrativesFile}: ${error instanceof Error ? error.message : String(error)}`;
          console.error(msg);
          // Fail loudly when a narratives file is explicitly requested so tests don't silently continue
          throw new Error(msg);
        }
      }
      
      const artifacts = await generateArtifacts(test.spec, sessionId, testGameId, specNarrativesOverride);
      result.artifactsGenerated = true;
      
      // Step 2: Validate artifacts
      const validation = validateArtifacts(artifacts);
      if (!validation.valid) {
        result.artifactErrors = validation.errors;
        result.duration = Date.now() - startTime;
        return result;
      }
    }
    
    // Extract player IDs from scenario actions
    const playerIds = [...new Set(scenario.playerActions.map(a => a.playerId))];
    
    // Step 3: Initialize simulation
    console.log(`[${test.name}] Starting simulation...`);
    const { publicMessage, playerStates } = await initializeSimulation(sessionId, playerIds);
    
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
        sessionId,
        action.playerId,
        JSON.stringify(action.actionData)
      );
      
      // Update tracking
      gameEnded = response.gameEnded || false;
      finalPlayerStates = response.playerStates;
      
      // Retrieve full game state for assertions
      finalGameState = await getGameState(sessionId);
      
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
async function generateArtifacts(
  spec: string, 
  sessionId: string, 
  gameId?: string,
  specNarrativesOverride?: Record<string, string>
): Promise<any> {
  // Use provided narrative override or extract from spec
  let specNarratives = specNarrativesOverride;
  
  if (!specNarratives) {
    specNarratives = extractSpecNarratives(spec);
  }
  
  // If narratives present, we pass them through to the simulation; no debug log.
  void specNarratives;
  
  // Use createSimulation which calls spec-processing-graph
  // Pass spec directly with extracted or overridden narratives
  // Signature: createSimulation(sessionId, gameId?, version?, options?)
  const result = await createSimulation(sessionId, gameId, 1, {
    overrideSpecification: spec,
    specNarrativesOverride: specNarratives
  });
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
