import { describe, expect, test } from "@jest/globals";
import {
  createSimulation,
  initializeSimulation,
  PlayerStates,
  processAction,
} from "#chaincraft/ai/simulate/simulate-workflow.js";
import { setConfig } from "#chaincraft/config.js";
import { fail } from "assert";

describe("Simulation Workflow", () => {
  setConfig("simulation-graph-type", "test-game-simulation");
  // Generate unique gameId for each test run to avoid cached artifacts
  const gameId = `test-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  
  // Use realistic UUID-style player IDs to test player mapping
  const player1Id = `player-${crypto.randomUUID()}`;
  const player2Id = `player-${crypto.randomUUID()}`;
  
  const initialGameSpec = `
    A game of rock-paper-scissors for 2 players. Each player's move is compared head-to-head.
    Players score 1 pt for a win, 0 pts for a tie, and -1 pt for a loss. The player with the 
    most points after 2 rounds wins the game. The winners are: rock beats scissors, scissors 
    beats paper, and paper beats rock.
  `;

  test("should create a simulation and return the player count", async () => {
    const { gameRules } = await createSimulation(
      gameId,
      initialGameSpec,
      1 // Initial version
    );

    expect(gameRules).toBeDefined();
    expect(gameRules.length).toBeGreaterThan(0);
  }, 120000); // 120s timeout for spec processing + artifact storage

  test("Should initialize the state when the required number of players join", async () => {
    const { publicMessage, playerStates } = await initializeSimulation(gameId, [
      player1Id,
      player2Id,
    ]);

    console.debug("publicMessage", publicMessage);
    console.debug("playerStates", playerStates);
    console.log("Player IDs used:", { player1Id, player2Id });

    expect(publicMessage).toBeDefined();
    expect(playerStates.size).toBe(2);
    // Verify both players are present with their UUID keys
    expect(playerStates.has(player1Id)).toBe(true);
    expect(playerStates.has(player2Id)).toBe(true);
    // After initialization, players should have action flags set
    Array.from(playerStates.values()).forEach(ps => {
      // actionsAllowed is optional, defaults to actionRequired
      expect(ps.actionRequired).toBeDefined();
    });
  });

  test(
    "Should process player moves and complete game",
    async () => {
      const playerMoves = [
        ["rock", "paper"],      // Round 1
        ["scissors", "rock"],   // Round 2
      ];
      const playerIds = [player1Id, player2Id];
      
      for (let round = 1; round <= 2; round++) {
        for (let playerIndex = 0; playerIndex < 2; playerIndex++) {
          const playerId = playerIds[playerIndex];
          let { publicMessage, playerStates, gameEnded } = await processAction(
            gameId,
            playerId,
            playerMoves[round - 1][playerIndex]
          ).catch((error) => {
            console.log("Received error in test %o.  Failing test.", error);
            fail(error.message);
          });
          validatePlayerStates(playerId, playerStates);
          expect(publicMessage).toBeDefined();
          expect(gameEnded).toEqual(round == 2 && playerIndex == 1);
        }
      }
    },
    4 * 60 * 1000  // 4 minutes for 2 players × 2 rounds
  );
});

function validatePlayerStates(playerId: string, playerStates: PlayerStates) {
  // Validate that the acting player has state returned
  const playerState = playerStates.get(playerId);
  expect(playerState).toBeDefined();
  // Private messages are optional - only set when game/instructions specify them
}
