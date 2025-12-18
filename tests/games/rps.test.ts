/**
 * Rock Paper Scissors Test
 * 
 * Converted from original simulate-workflow test to new test harness format.
 */

import { GameTest } from "../harness/types.js";
import { createPlayerIds } from "../harness/helpers.js";

// Generate player IDs once for all scenarios
const [player1Id, player2Id] = createPlayerIds(2);

export const rpsTest: GameTest = {
  name: "Rock Paper Scissors",
  
  spec: `# Rock Paper Scissors

## Game Overview

A game of rock-paper-scissors for 2 players. Each player's move is compared head-to-head.

## Scoring

Players score points based on the outcome of each round:
- Win: +1 point
- Tie: 0 points  
- Loss: -1 point

## Win Conditions

The winners are determined by:
- Rock beats Scissors
- Scissors beats Paper
- Paper beats Rock

## Game Structure

The game runs for 2 rounds. After both rounds are complete, the player with the most points wins the game.

## Gameplay Flow

1. Both players simultaneously choose rock, paper, or scissors
2. The game evaluates the choices and awards points
3. After 2 rounds, the game ends and declares the winner
`,

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
        winner: player2Id,  // p2 wins both rounds
        finalPhase: "finished"
      },
      assertions: [
        (state) => ({
          passed: state.game.currentRound === 2,
          message: "Should complete 2 rounds"
        }),
        (state) => ({
          passed: state.game.gameEnded === true,
          message: "Game should be ended"
        }),
        (state) => {
          const p2 = state.players[player2Id];
          return {
            passed: p2 && p2.score > 0,
            message: "Player 2 should have positive score after winning both rounds"
          };
        }
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
        winner: null,  // Tie game
        finalPhase: "finished"
      },
      assertions: [
        (state) => ({
          passed: state.game.currentRound === 2,
          message: "Should complete 2 rounds"
        }),
        (state) => {
          const p1 = state.players[player1Id];
          const p2 = state.players[player2Id];
          return {
            passed: p1 && p2 && p1.score === p2.score && p1.score === 0,
            message: "Both players should have 0 score in a tied game"
          };
        }
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
        winner: null,  // Tie overall (each won once)
        finalPhase: "finished"
      },
      assertions: [
        (state) => ({
          passed: state.game.currentRound === 2,
          message: "Should complete 2 rounds"
        }),
        (state) => {
          const p1 = state.players[player1Id];
          const p2 = state.players[player2Id];
          return {
            passed: p1 && p2 && p1.score === p2.score && p1.score === 0,
            message: "Each player should have 0 points when they each win one round"
          };
        }
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
        (state) => {
          const p1 = state.players[player1Id];
          return {
            passed: p1 && p1.score === 2,
            message: "Player 1 should have 2 points after winning both rounds"
          };
        }
      ]
    }
  ]
};
