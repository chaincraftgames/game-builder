/**
 * Integration test: Design workflow → Simulation workflow
 * 
 * This test validates that a game specification created in the design workflow
 * can be successfully retrieved and used by the simulation workflow without
 * passing the spec explicitly.
 */

import { continueDesignConversation } from "#chaincraft/ai/design/design-workflow.js";
import { 
  createSimulation, 
  initializeSimulation,
  processAction
} from "#chaincraft/ai/simulate/simulate-workflow.js";
import { setConfig } from "#chaincraft/config.js";

describe("Design-to-Sim Integration", () => {
  // Use test-specific graph types to avoid conflicts
  setConfig("design-graph-type", "test-design-to-sim-integration");
  setConfig("simulation-graph-type", "test-design-to-sim-integration");

  // Generate unique game ID that will be used as both conversationId and gameId
  const gameId = `integration-test-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  
  const player1Id = `player-${crypto.randomUUID()}`;
  const player2Id = `player-${crypto.randomUUID()}`;

  test("should create design spec and use it in simulation without explicit spec", async () => {
    console.log("\n=== DESIGN-TO-SIM INTEGRATION TEST ===\n");
    console.log("Game ID:", gameId);

    // PHASE 1: Design workflow - Create game specification
    console.log("\n--- PHASE 1: Design Workflow ---");
    console.log("Creating rock-paper-scissors game specification...");

    const designResponse = await continueDesignConversation(
      gameId,
      `Create a rock-paper-scissors game for 2 players. Each player chooses rock, paper, or scissors. 
       Rock beats scissors, scissors beats paper, paper beats rock. 
       Play 1 round. Winner gets 1 point, loser gets 0, ties both get 0. 
       Player with most points wins.`
    );

    console.log("✓ Design response received");
    console.log("✓ Response length:", designResponse.designResponse.length);

    // Request explicit spec generation if not already generated
    let specVersion: number;
    if (!designResponse.specification) {
      console.log("Requesting explicit spec generation...");
      const specResponse = await continueDesignConversation(
        gameId,
        "Please create the full game specification."
      );

      if (!specResponse.specification) {
        throw new Error("Failed to generate specification");
      }

      specVersion = specResponse.specification.version;
      console.log("✓ Spec generated, version:", specVersion);
      console.log("✓ Spec length:", specResponse.specification.designSpecification.length);
    } else {
      specVersion = designResponse.specification.version;
      console.log("✓ Spec generated immediately, version:", specVersion);
      console.log("✓ Spec length:", designResponse.specification.designSpecification.length);
    }

    // PHASE 2: Simulation workflow - Use design spec WITHOUT passing it explicitly
    console.log("\n--- PHASE 2: Simulation Workflow (Retrieval Test) ---");
    console.log("Creating simulation WITHOUT passing spec explicitly...");
    console.log("Using gameId:", gameId, "and version:", specVersion);

    // This should retrieve the spec from the design workflow
    const { gameRules } = await createSimulation(
      gameId,
      specVersion
      // NOTE: No third parameter - should retrieve from design workflow
    );

    console.log("✓ Simulation created successfully");
    console.log("✓ Game rules extracted, length:", gameRules.length);
    expect(gameRules).toBeDefined();
    expect(gameRules.length).toBeGreaterThan(100);
    expect(gameRules.toLowerCase()).toContain("rock");
    expect(gameRules.toLowerCase()).toContain("paper");
    expect(gameRules.toLowerCase()).toContain("scissors");

    // PHASE 3: Verify simulation actually works
    console.log("\n--- PHASE 3: Verify Simulation Works ---");
    console.log("Initializing with players...");

    const { publicMessage, playerStates } = await initializeSimulation(
      gameId,
      [player1Id, player2Id]
    );

    console.log("✓ Simulation initialized");
    console.log("✓ Public message:", publicMessage?.substring(0, 100) || "none");
    console.log("✓ Player states:", playerStates.size);
    expect(playerStates.size).toBe(2);

    // Test a game action
    console.log("\nProcessing player action...");
    const action1Response = await processAction(
      gameId,
      player1Id,
      "I choose rock"
    );

    console.log("✓ Action processed");
    console.log("✓ Response has player states:", action1Response.playerStates.size);
    expect(action1Response.playerStates.size).toBeGreaterThan(0);

    console.log("\n✅ Integration test completed successfully!");
    console.log("   Design spec → Sim workflow retrieval works correctly\n");

  }, 180000); // 3 minute timeout for full integration test
});
