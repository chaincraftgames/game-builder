/**
 * Test Harness Runner
 * 
 * Runs game tests through the test harness.
 * 
 * Supports reliability testing via environment variables:
 * - RELIABILITY_SCENARIO: scenario index to test (default: all scenarios)
 * - RELIABILITY_ITERATIONS: number of iterations to run (default: 1)
 * 
 * Example: RELIABILITY_SCENARIO=1 RELIABILITY_ITERATIONS=10 npm run test:harness -- --testNamePattern="RPS"
 */

import { describe, it } from "@jest/globals";
import { setConfig } from "#chaincraft/config.js";
import { runGameTestScenario, assertTestSuccess, runReliabilityTest } from "./test-runner.js";

// Parse reliability settings from environment
const reliabilityScenario = process.env.RELIABILITY_SCENARIO ? parseInt(process.env.RELIABILITY_SCENARIO, 10) : null;
const reliabilityIterations = process.env.RELIABILITY_ITERATIONS ? parseInt(process.env.RELIABILITY_ITERATIONS, 10) : 1;
const isReliabilityMode = reliabilityIterations > 1;

describe("Game Test Harness", () => {
  // Configure to use test simulation graph
  setConfig("simulation-graph-type", "test-game-simulation");
  
  if (isReliabilityMode) {
    // Reliability mode - run multiple iterations
    it(`should run RPS reliability test (${reliabilityIterations} iterations, scenario ${reliabilityScenario ?? 'all'})`, async () => {
      const report = await runReliabilityTest("rps", reliabilityScenario, reliabilityIterations);
      
      // Assert at least 80% success rate
      if (report.successRate < 0.8) {
        throw new Error(`Reliability too low: ${(report.successRate * 100).toFixed(1)}% (expected >= 80%)`);
      }
    }, reliabilityIterations * 4 * 60 * 1000); // 4 minutes per iteration

    it(`should run Westward Peril reliability test (${reliabilityIterations} iterations, scenario ${reliabilityScenario ?? 'all'})`, async () => {
      const report = await runReliabilityTest("westward-peril", reliabilityScenario, reliabilityIterations);
      
      // Assert at least 80% success rate
      if (report.successRate < 0.8) {
        throw new Error(`Reliability too low: ${(report.successRate * 100).toFixed(1)}% (expected >= 80%)`);
      }
    }, reliabilityIterations * 10 * 60 * 1000); // 10 minutes per iteration
  } else {
    // Normal mode - single run per scenario
    it("should run RPS test - scenario 1", async () => {
      const result = await runGameTestScenario("rps", 0);
      assertTestSuccess(result);
    }, 4 * 60 * 1000); // 4 minutes timeout

    it("should run Westward Peril test - scenario 1", async () => {
      const result = await runGameTestScenario("westward-peril", 0);
      assertTestSuccess(result);
    }, 10 * 60 * 1000); // 10 minutes timeout for complex narrative games

    it("should run Wacky Weapons Router Bug test - scenario 1", async () => {
      const result = await runGameTestScenario("wacky-weapons-router-bug", 0);
      assertTestSuccess(result);
    }, 4 * 60 * 1000); // 4 minutes timeout
  }
});
