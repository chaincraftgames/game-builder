import { describe, expect, test } from "@jest/globals";
import {
  createSimulation,
  initializeSimulation,
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
    const { playerCount, gameRules } = await createSimulation(
      gameId,
      initialGameSpec,
      1 // Initial version
    );

    expect(playerCount.minPlayers).toEqual(3);
    expect(playerCount.maxPlayers).toEqual(3);
    expect(gameRules).toBeDefined();
    expect(gameRules.length).toBeGreaterThan(0);
  });

  if (false) {
  test("Should initialize the state when the required number of players join", async () => {
    const playerMessages = await initializeSimulation(gameId, [
      "player1",
      "player2",
      "player3",
    ]);

    console.debug("playerMessages", playerMessages);

    expect(playerMessages.size).toEqual(3);
    expect(playerMessages.get("player1")).not.toBeUndefined();
    expect(playerMessages.get("player2")).not.toBeUndefined();
    expect(playerMessages.get("player3")).not.toBeUndefined();
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
          let { playerMessages, gameEnded } = await processAction(
            gameId,
            `player${playerIndex}`,
            playerMoves[round - 1][playerIndex - 1]
          ).catch((error) => {
            console.log("Received error in test %o.  Failing test.", error);
            fail(error.message);
          });
          validatePlayerMessages(playerMessages);
          expect(gameEnded).toEqual(round == 3 && playerIndex == 3);
        }
      }
    },
    9 * 60 * 1000
  );
  }
});

function validatePlayerMessages(playerMessages: Map<string, string>) {
  expect(playerMessages.size).toEqual(3);
  expect(playerMessages.get("player1")).not.toBeUndefined();
  expect(playerMessages.get("player2")).not.toBeUndefined();
  expect(playerMessages.get("player3")).not.toBeUndefined();
}
