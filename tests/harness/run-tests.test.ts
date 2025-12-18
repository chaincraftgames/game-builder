/**
 * Test Harness Runner
 * 
 * Runs game tests through the test harness.
 */

import { describe, expect, it } from "@jest/globals";
import { executeGameTest } from "./executor.js";
import { getGameTest } from "../games/index.js";
import { createGameId } from "./helpers.js";
import { setConfig } from "#chaincraft/config.js";

describe("Game Test Harness", () => {
  // Configure to use test simulation graph
  setConfig("simulation-graph-type", "test-game-simulation");
  
  it("should run RPS test - scenario 1", async () => {
    const rpsTest = getGameTest("Rock Paper Scissors");
    const scenario = rpsTest.scenarios[0]; // First scenario: clear winner
    
    // Use provided game ID (for reusing artifacts) or generate fresh one
    const gameId = process.env.GAME_ID || createGameId("rps");
    const usingExistingArtifacts = !!process.env.GAME_ID;
    
    console.log(`\n=== Running: ${rpsTest.name} - ${scenario.name} ===\n`);
    console.log(`Game ID: ${gameId} ${usingExistingArtifacts ? '(reusing existing artifacts)' : '(generating fresh artifacts)'}`);
    
    // Pass the game ID so artifacts are generated once and reused across scenarios
    const result = await executeGameTest(rpsTest, scenario, gameId);
    
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
    
    // Test should pass
    expect(result.artifactsGenerated).toBe(true);
    expect(result.simulationCompleted).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.simulationError).toBeUndefined();
    
  }, 4 * 60 * 1000); // 4 minutes timeout
});
