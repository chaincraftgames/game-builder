/**
 * Test Harness Runner
 * 
 * Runs game tests through the test harness.
 */

import { describe, it } from "@jest/globals";
import { setConfig } from "#chaincraft/config.js";
import { runGameTestScenario, assertTestSuccess } from "./test-runner.js";

describe("Game Test Harness", () => {
  // Configure to use test simulation graph
  setConfig("simulation-graph-type", "test-game-simulation");
  
  it("should run RPS test - scenario 1", async () => {
    const result = await runGameTestScenario("rps", 0);
    assertTestSuccess(result);
  }, 4 * 60 * 1000); // 4 minutes timeout

  it("should run Westward Peril test - scenario 1", async () => {
    const result = await runGameTestScenario("westward-peril", 0);
    assertTestSuccess(result);
  }, 4 * 60 * 1000); // 4 minutes timeout
});
