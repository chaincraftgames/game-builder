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
  const gameId = Math.random().toString(36).substring(7);
  const initialGameSpec = `
    A game or rock-paper-scissors for 3 players.  Each player move is compared to the other 
    two players moves.  Players score 1 pt for each head to head win and 0 pts for a tie and
    -1 pt for a loss.  The player with the most points after 3 rounds wins the game.  The 
    winners of head to head matchups are as follows: rock beats scissors, scissors beats paper,
    and paper beats rock.
  `;

  test("should create a simulation and return the player count", async () => {
    const { gameRules } = await createSimulation(
      gameId,
      initialGameSpec,
      1 // Initial version
    );

    expect(gameRules).toBeDefined();
    expect(gameRules.length).toBeGreaterThan(0);
  });

  test("Should initialize the state when the required number of players join", async () => {
    const { publicMessage, playerStates } = await initializeSimulation(gameId, [
      "player1",
      "player2",
      "player3",
    ]);

    console.debug("publicMessage", publicMessage);
    console.debug("playerStates", playerStates);

    expect(publicMessage).toBeDefined();
    Array.from(playerStates.values()).forEach(
      ps => expect(ps.privateMessage).toBeUndefined()
    );
    // expect(privateMessages.get("player1")).not.toBeUndefined();
    // expect(privateMessages.get("player2")).not.toBeUndefined();
    // expect(privateMessages.get("player3")).not.toBeUndefined();
  });

  test(
    "Should return player messages wnh player makes a move",
    async () => {
      const playerMoves = [
        ["rock", "paper", "scissors"],
        ["rock", "rock", "paper"],
        ["scissors", "rock", "paper"],
      ];
      for (let round = 1; round <= 3; round++) {
        for (let playerIndex = 1; playerIndex <= 3; playerIndex++) {
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
          expect(gameEnded).toEqual(round == 3 && playerIndex == 3);
        }
      }
    },
    9 * 60 * 1000
  );
});

function validatePlayerStates(playerId: string, playerStates: PlayerStates) {
  expect(playerStates.get(playerId)?.privateMessage).toBeDefined();
}
