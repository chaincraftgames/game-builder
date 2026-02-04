/**
 * Test Runner Utilities
 * 
 * Helper functions for running game tests with consistent logging and assertions.
 */

import { expect } from "@jest/globals";
import { executeGameTest } from "./executor.js";
import { getGameTest, getGameTestsDirectory } from "../games/index.js";
import { createGameId } from "./helpers.js";
import { ConsoleCapture, saveTestResult } from "./test-logger.js";
import type { TestResult, ReliabilityReport } from "./types.js";
import { runReliabilityTest as runReliabilityTestInternal, runFullReliabilityTest } from "./reliability.js";

/**
 * Run a single game test scenario with full logging and assertions
 */
export async function runGameTestScenario(
  gameKey: string,
  scenarioIndex: number,
  gameIdOverride?: string
): Promise<TestResult> {
  const gameTest = getGameTest(gameKey);
  if (!gameTest) {
    throw new Error(`Game test not found: ${gameKey}`);
  }
  
  if (scenarioIndex >= gameTest.scenarios.length) {
    throw new Error(`Scenario index ${scenarioIndex} out of range for ${gameKey} (has ${gameTest.scenarios.length} scenarios)`);
  }
  
  const scenario = gameTest.scenarios[scenarioIndex];
  
  // Use provided game ID (for reusing artifacts) or generate fresh one
  const gameId = gameIdOverride || process.env.GAME_ID || createGameId(gameKey);
  const usingExistingArtifacts = !!(gameIdOverride || process.env.GAME_ID);
  
  console.log(`\n=== Running: ${gameTest.name} - ${scenario.name} ===\n`);
  console.log(`Game ID: ${gameId} ${usingExistingArtifacts ? '(reusing existing artifacts)' : '(generating fresh artifacts)'}`);
  
  // Start capturing console output
  const consoleCapture = new ConsoleCapture();
  consoleCapture.start();
  
  try {
    // Execute the test
    const result = await executeGameTest(gameTest, scenario, gameId, getGameTestsDirectory());
    
    // Log results
    logTestResult(gameTest.name, scenario.name, result);
    
    // Save results and logs to files
    saveTestResult(gameKey, scenarioIndex, result, gameId);
    consoleCapture.save(gameKey, scenarioIndex, gameId);
    
    return result;
  } finally {
    // Always stop capturing even if test throws
    consoleCapture.stop();
  }
}

/**
 * Run all scenarios for a game test
 */
export async function runAllGameScenarios(
  gameKey: string,
  gameIdOverride?: string
): Promise<TestResult[]> {
  const gameTest = getGameTest(gameKey);
  if (!gameTest) {
    throw new Error(`Game test not found: ${gameKey}`);
  }
  
  const results: TestResult[] = [];
  
  // Use same gameId for all scenarios to reuse artifacts
  const gameId = gameIdOverride || process.env.GAME_ID || createGameId(gameKey);
  
  for (let i = 0; i < gameTest.scenarios.length; i++) {
    const result = await runGameTestScenario(gameKey, i, gameId);
    results.push(result);
  }
  
  return results;
}

/**
 * Log test result with consistent formatting
 */
export function logTestResult(gameName: string, scenarioName: string, result: TestResult): void {
  console.log("\n=== Test Result ===");
  console.log(`Artifacts generated: ${result.artifactsGenerated}`);
  console.log(`Simulation completed: ${result.simulationCompleted}`);
  console.log(`Turns executed: ${result.turns}`);
  console.log(`Passed: ${result.passed}`);
  console.log(`Duration: ${result.duration}ms`);
  
  if (result.artifactErrors) {
    console.log("Artifact errors:", result.artifactErrors);
  }
  
  if (result.simulationError) {
    console.log("Simulation error:", result.simulationError);
  }
  
  if (result.assertionResults.length > 0) {
    console.log("\nAssertions:");
    result.assertionResults.forEach((a, i) => {
      console.log(`  ${i + 1}. ${a.passed ? '✓' : '✗'} ${a.message}`);
    });
  }
  
  if (result.finalState) {
    console.log("\nFinal state:", JSON.stringify(result.finalState, null, 2));
  }
}

/**
 * Assert that a test result meets basic success criteria
 */
export function assertTestSuccess(result: TestResult): void {
  expect(result.artifactsGenerated).toBe(true);
  expect(result.simulationCompleted).toBe(true);
  expect(result.passed).toBe(true);
  expect(result.simulationError).toBeUndefined();
}

/**
 * Assert that artifacts were generated (even if simulation failed)
 */
export function assertArtifactsGenerated(result: TestResult): void {
  expect(result.artifactsGenerated).toBe(true);
  expect(result.artifactErrors).toBeUndefined();
}

/**
 * Assert that simulation completed (even if test assertions failed)
 */
export function assertSimulationCompleted(result: TestResult): void {
  expect(result.artifactsGenerated).toBe(true);
  expect(result.simulationCompleted).toBe(true);
  expect(result.simulationError).toBeUndefined();
}

/**
 * Run reliability test for a game
 * @param gameKey - Game identifier (e.g., "rps")
 * @param scenarioIndex - Scenario to test (null for all scenarios)
 * @param iterations - Number of iterations to run
 */
export async function runReliabilityTest(
  gameKey: string,
  scenarioIndex: number | null,
  iterations: number
): Promise<ReliabilityReport> {
  const gameTest = getGameTest(gameKey);
  if (!gameTest) {
    throw new Error(`Game test not found: ${gameKey}`);
  }
  
  if (scenarioIndex !== null) {
    // Test specific scenario
    if (scenarioIndex >= gameTest.scenarios.length) {
      throw new Error(`Scenario index ${scenarioIndex} out of range for ${gameKey} (has ${gameTest.scenarios.length} scenarios)`);
    }
    
    const scenario = gameTest.scenarios[scenarioIndex];
    return runReliabilityTestInternal(gameTest, scenario, iterations);
  } else {
    // Test all scenarios
    const reports = await runFullReliabilityTest(gameTest, iterations);
    
    // Aggregate into single report
    const totalSuccess = reports.reduce((sum, r) => sum + r.successCount, 0);
    const totalIterations = reports.reduce((sum, r) => sum + r.iterations, 0);
    const avgDuration = reports.reduce((sum, r) => sum + r.averageDuration, 0) / reports.length;
    
    return {
      testName: `${gameTest.name} (all scenarios)`,
      iterations: totalIterations,
      successCount: totalSuccess,
      successRate: totalSuccess / totalIterations,
      averageDuration: avgDuration,
      failures: reports.flatMap(r => r.failures),
    };
  }
}
