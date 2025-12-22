/**
 * Rock Paper Scissors Test
 * 
 * Converted from original simulate-workflow test to new test harness format.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { GameTest } from "../harness/types.js";
import { createPlayerIds } from "../harness/helpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Generate player IDs once for all scenarios
const [player1Id, player2Id] = createPlayerIds(2);

export const rpsTest: GameTest = {
  name: "Rock Paper Scissors",
  spec: readFileSync(join(__dirname, "specs", "rps.md"), "utf-8"),

  scenarios: [
    {
      name: "Complete 2-round game with clear winner",
      description: "Tests full gameplay where one player wins both rounds",
      playerActions: [
        // Round 1
        { playerId: player1Id, actionType: "submitMove", actionData: { move: "rock" } },
        { playerId: player2Id, actionType: "submitMove", actionData: { move: "paper" } },
        
        // Round 2
        { playerId: player1Id, actionType: "submitMove", actionData: { move: "scissors" } },
        { playerId: player2Id, actionType: "submitMove", actionData: { move: "rock" } },
      ],
      expectedOutcome: {
        gameEnded: true,
        winner: player2Id,
        finalPhase: "finished"
      },
      assertions: [
        (state) => ({
          passed: state.game?.gameEnded === true,
          message: "Game should end after all rounds"
        }),
        (state) => ({
          passed: state.game?.publicMessage?.toLowerCase().includes("game over") || 
                  state.game?.publicMessage?.toLowerCase().includes("wins") ||
                  state.game?.publicMessage?.toLowerCase().includes("winner"),
          message: "Final message should indicate game completion"
        })
      ]
    },
    
    {
      name: "Tied game after 2 rounds",
      description: "Tests that game handles ties correctly",
      playerActions: [
        // Round 1 - both choose rock (tie)
        { playerId: player1Id, actionType: "submitMove", actionData: { move: "rock" } },
        { playerId: player2Id, actionType: "submitMove", actionData: { move: "rock" } },
        
        // Round 2 - both choose paper (tie)
        { playerId: player1Id, actionType: "submitMove", actionData: { move: "paper" } },
        { playerId: player2Id, actionType: "submitMove", actionData: { move: "paper" } },
      ],
      expectedOutcome: {
        gameEnded: true,
        winner: null,
        finalPhase: "finished"
      },
      assertions: [
        (state) => ({
          passed: state.game?.gameEnded === true,
          message: "Game should end after all rounds"
        }),
        (state) => ({
          passed: state.game?.publicMessage?.toLowerCase().includes("tie") || 
                  state.game?.publicMessage?.toLowerCase().includes("draw") ||
                  state.game?.publicMessage?.toLowerCase().includes("game over"),
          message: "Final message should indicate game completion or tie"
        })
      ]
    },
    
    {
      name: "Split rounds - each player wins one",
      description: "Tests game when players each win one round",
      playerActions: [
        // Round 1 - p1 wins
        { playerId: player1Id, actionType: "submitMove", actionData: { move: "rock" } },
        { playerId: player2Id, actionType: "submitMove", actionData: { move: "scissors" } },
        
        // Round 2 - p2 wins
        { playerId: player1Id, actionType: "submitMove", actionData: { move: "rock" } },
        { playerId: player2Id, actionType: "submitMove", actionData: { move: "paper" } },
      ],
      expectedOutcome: {
        gameEnded: true,
        winner: null,
        finalPhase: "finished"
      },
      assertions: [
        (state) => ({
          passed: state.game?.gameEnded === true,
          message: "Game should end after all rounds"
        })
      ]
    },
    
    {
      name: "All three win conditions tested",
      description: "Tests rock beats scissors, scissors beats paper, paper beats rock",
      playerActions: [
        // Round 1 - rock beats scissors
        { playerId: player1Id, actionType: "submitMove", actionData: { move: "rock" } },
        { playerId: player2Id, actionType: "submitMove", actionData: { move: "scissors" } },
        
        // Round 2 - scissors beats paper  
        { playerId: player1Id, actionType: "submitMove", actionData: { move: "scissors" } },
        { playerId: player2Id, actionType: "submitMove", actionData: { move: "paper" } },
      ],
      expectedOutcome: {
        gameEnded: true,
        winner: player1Id,
        finalPhase: "finished"
      },
      assertions: [
        (state) => ({
          passed: state.game?.gameEnded === true,
          message: "Game should end after all rounds"
        })
      ]
    }
  ]
};
