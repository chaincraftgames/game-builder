import { describe, expect, test } from "@jest/globals";
import {
  createSimulation,
  initializeSimulation,
  PlayerStates,
  processAction,
} from "#chaincraft/ai/simulate/simulate-workflow.js";
import { setConfig } from "#chaincraft/config.js";

describe("Coin Flip Simulation", () => {
  setConfig("simulation-graph-type", "test-game-simulation");
  const gameId = `coinflip-${Math.random().toString(36).substring(7)}`;
  
  // Use realistic UUID-style player IDs to match RPS test pattern
  const player1Id = `player-${crypto.randomUUID()}`;
  const player2Id = `player-${crypto.randomUUID()}`;
  
  const coinFlipSpec = `
    A coin flip game for 2 players. The game lasts 2 rounds.
    
    Each round:
    1. Both players call "heads" or "tails"
    2. A coin is flipped
    3. Players who called correctly get 1 point
    4. Players who called incorrectly get 0 points
    
    After 2 rounds, the player with the most points wins.
    If tied, it's a draw.
  `;

  test("should create coin flip simulation and return game rules", async () => {
    const { gameRules } = await createSimulation(
      "test-session-1", // sessionId
      gameId,
      1, // version
      {
        overrideSpecification: coinFlipSpec,
      }
    );

    expect(gameRules).toBeDefined();
    expect(gameRules.length).toBeGreaterThan(0);
    console.log("[coin-flip-test] Game rules generated");
  }, 90000); // 90s timeout for spec processing

  test("should initialize coin flip game with 2 players", async () => {
    const { publicMessage, playerStates } = await initializeSimulation(gameId, [
      player1Id,
      player2Id,
    ]);

    console.log("[coin-flip-test] Public message:", publicMessage);
    console.log("[coin-flip-test] Player states:", Array.from(playerStates.entries()));

    expect(publicMessage).toBeDefined();
    expect(playerStates.size).toBe(2);
    
    // Coin flip may provide instructions to players at initialization (this is fine)
    console.log("[coin-flip-test] Initialization complete");
  });

  test("should play complete coin flip game (2 rounds)", async () => {
    // 2 rounds, 2 players each = 4 total actions
    const playerCalls = [
      ["heads", "tails"],    // Round 1
      ["tails", "heads"],    // Round 2
    ];
    const playerIds = [player1Id, player2Id];
    
    let finalGameEnded = false;
    
    for (let round = 1; round <= 2; round++) {
      console.log(`[coin-flip-test] === Round ${round} ===`);
      
      for (let playerIndex = 0; playerIndex < 2; playerIndex++) {
        const playerId = playerIds[playerIndex];
        const call = playerCalls[round - 1][playerIndex];
        
        console.log(`[coin-flip-test] ${playerId} calls: ${call}`);
        
        const { publicMessage, playerStates, gameEnded } = await processAction(
          gameId,
          playerId,
          call
        );
        
        console.log(`[coin-flip-test] Public: ${publicMessage}`);
        console.log(`[coin-flip-test] Game ended: ${gameEnded}`);
        
        expect(publicMessage).toBeDefined();
        expect(playerStates.size).toBe(2);
        
        // Validate player state exists
        const playerState = playerStates.get(playerId);
        expect(playerState).toBeDefined();
        
        // After last action, game should end
        if (round === 2 && playerIndex === 1) {
          finalGameEnded = gameEnded;
        }
      }
    }
    
    // Game should be ended after 2 rounds
    expect(finalGameEnded).toBe(true);
    console.log("[coin-flip-test] Game completed successfully!");
  }, 4 * 60 * 1000); // 4 minutes for 2 players × 2 rounds
});
