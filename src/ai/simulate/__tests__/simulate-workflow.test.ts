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
      "player1",
      "player2",
    ]);

    console.debug("publicMessage", publicMessage);
    console.debug("playerStates", playerStates);

    expect(publicMessage).toBeDefined();
    expect(playerStates.size).toBe(2);
    // Players should have messages after initialization
    Array.from(playerStates.values()).forEach(
      ps => expect(ps.privateMessage).toBeDefined()
    );
  });

  test(
    "Should process player moves and complete game",
    async () => {
      const playerMoves = [
        ["rock", "paper"],      // Round 1
        ["scissors", "rock"],   // Round 2
      ];
      for (let round = 1; round <= 2; round++) {
        for (let playerIndex = 1; playerIndex <= 2; playerIndex++) {
          const playerId = `player${playerIndex}`;
          let { publicMessage, playerStates, gameEnded } = await processAction(
            gameId,
            playerId,
            playerMoves[round - 1][playerIndex - 1]
          ).catch((error) => {
            console.log("Received error in test %o.  Failing test.", error);
            fail(error.message);
          });
          validatePlayerStates(playerId, playerStates);
          expect(publicMessage).toBeDefined();
          expect(gameEnded).toEqual(round == 2 && playerIndex == 2);
        }
      }
    },
    4 * 60 * 1000  // 4 minutes for 2 players × 2 rounds
  );
});

function validatePlayerStates(playerId: string, playerStates: PlayerStates) {
  expect(playerStates.get(playerId)?.privateMessage).toBeDefined();
}
