/**
 * Integration Test for Runtime Graph
 * 
 * Tests full 3-round RPS game with automatic phase transitions
 */

import { describe, it, expect } from "@jest/globals";
import { createRuntimeGraph } from "../graphs/runtime-graph/index.js";
import { MemorySaver } from "@langchain/langgraph";
import {
  rpsGameRules,
  rpsStateSchema,
  rpsStateTransitions,
  rpsPhaseInstructions
} from "./fixtures/rps-artifacts.js";

describe("Runtime Graph Integration", () => {
  it("should execute full 3-round RPS game with automatic transitions", async () => {
    console.log("\n" + "=".repeat(80));
    console.log("RUNTIME GRAPH INTEGRATION TEST: 3-Round Rock-Paper-Scissors");
    console.log("=".repeat(80));
    
    // Create graph with memory checkpoint
    const checkpointer = new MemorySaver();
    const graph = await createRuntimeGraph(checkpointer);
    
    const threadId = "test-rps-game-001";
    const config = { configurable: { thread_id: threadId } };
    
    // Base state with artifacts (these would come from spec-processing in production)
    const baseState = {
      gameRules: rpsGameRules,
      stateSchema: rpsStateSchema,
      stateTransitions: rpsStateTransitions,
      phaseInstructions: rpsPhaseInstructions,
      players: ["player1", "player2", "player3"],
      isInitialized: false,
      currentPhase: "",
      selectedInstructions: "",
      requiresPlayerInput: true,
      transitionReady: false,
      nextPhase: "",
      plannedChanges: "",
      gameState: "",
      playerAction: undefined,
    };
    
    // ========================================================================
    // STEP 1: Initialize game (should auto-transition through setup -> playing)
    // ========================================================================
    console.log("\n--- STEP 1: Initialize Game ---");
    const initResult = await graph.invoke(baseState, config);
    
    const initState = JSON.parse(initResult.gameState);
    console.log("Initial state:", JSON.stringify(initState, null, 2));
    
    expect(initState.game.phase).toBe("playing");
    expect(initState.game.currentRound).toBe(1);
    expect(initState.game.totalRounds).toBe(3);
    // Note: Scores might be null initially, check they exist as numbers after first round
    expect(initState.players.player1).toBeDefined();
    expect(initState.players.player2).toBeDefined();
    expect(initState.players.player3).toBeDefined();
    expect(initResult.requiresPlayerInput).toBe(true);
    console.log("✅ Game initialized in playing phase, round 1");
    
    // ========================================================================
    // ROUND 1: All players submit moves
    // ========================================================================
    console.log("\n" + "=".repeat(80));
    console.log("ROUND 1");
    console.log("=".repeat(80));
    
    // Helper to invoke with just player action (artifacts + action only)
    const invokeAction = async (playerId: string, action: string) => {
      return await graph.invoke({
        gameRules: rpsGameRules,
        stateSchema: rpsStateSchema,
        stateTransitions: rpsStateTransitions,
        phaseInstructions: rpsPhaseInstructions,
        players: ["player1", "player2", "player3"],
        playerAction: { playerId, playerAction: action }
      }, config);
    };
    
    // Player 1 plays rock
    console.log("\n--- Player 1: rock ---");
    const r1p1Result = await invokeAction("player1", "rock");
    
    let gameState = JSON.parse(r1p1Result.gameState);
    expect(gameState.game.phase).toBe("playing");
    expect(gameState.game.currentRoundMoves.player1).toBe("rock");
    expect(r1p1Result.requiresPlayerInput).toBe(true);
    console.log("✅ Player 1 submitted rock, still in playing phase");
    
    // Player 2 plays paper
    console.log("\n--- Player 2: paper ---");
    const r1p2Result = await invokeAction("player2", "paper");
    
    gameState = JSON.parse(r1p2Result.gameState);
    expect(gameState.game.phase).toBe("playing");
    expect(gameState.game.currentRoundMoves.player2).toBe("paper");
    expect(r1p2Result.requiresPlayerInput).toBe(true);
    console.log("✅ Player 2 submitted paper, still in playing phase");
    
    // Player 3 plays scissors - should trigger auto-transition to scoring then back to playing
    console.log("\n--- Player 3: scissors (triggers scoring) ---");
    const r1p3Result = await invokeAction("player3", "scissors");
    
    gameState = JSON.parse(r1p3Result.gameState);
    console.log("State after player 3:", JSON.stringify(gameState, null, 2));
    
    // Should have auto-transitioned: playing -> scoring -> playing (round 2)
    expect(gameState.game.phase).toBe("playing");
    expect(gameState.game.currentRound).toBe(2);
    expect(Object.keys(gameState.game.currentRoundMoves)).toHaveLength(0); // Cleared for new round
    expect(r1p3Result.requiresPlayerInput).toBe(true);
    
    // Check scores (all different = all score)
    expect(gameState.players.player1.score).toBe(1);
    expect(gameState.players.player2.score).toBe(1);
    expect(gameState.players.player3.score).toBe(1);
    console.log("✅ Round 1 complete, auto-transitioned to round 2");
    console.log(`   Scores: P1=${gameState.players.player1.score}, P2=${gameState.players.player2.score}, P3=${gameState.players.player3.score}`);
    
    // ========================================================================
    // ROUND 2: All players submit moves
    // ========================================================================
    console.log("\n" + "=".repeat(80));
    console.log("ROUND 2");
    console.log("=".repeat(80));
    
    // Player 1 plays rock
    console.log("\n--- Player 1: rock ---");
    const r2p1Result = await invokeAction("player1", "rock");
    
    gameState = JSON.parse(r2p1Result.gameState);
    expect(gameState.game.phase).toBe("playing");
    expect(gameState.game.currentRound).toBe(2);
    console.log("✅ Player 1 submitted rock");
    
    // Player 2 plays rock (tie with player1)
    console.log("\n--- Player 2: rock ---");
    const r2p2Result = await invokeAction("player2", "rock");
    
    gameState = JSON.parse(r2p2Result.gameState);
    expect(gameState.game.phase).toBe("playing");
    console.log("✅ Player 2 submitted rock");
    
    // Player 3 plays paper - should trigger scoring (paper beats rock, player3 wins)
    console.log("\n--- Player 3: paper (triggers scoring) ---");
    const r2p3Result = await invokeAction("player3", "paper");
    
    gameState = JSON.parse(r2p3Result.gameState);
    console.log("State after round 2:", JSON.stringify(gameState, null, 2));
    
    expect(gameState.game.phase).toBe("playing");
    expect(gameState.game.currentRound).toBe(3);
    expect(Object.keys(gameState.game.currentRoundMoves)).toHaveLength(0);
    
    // Check scores (player3 wins: paper beats rock)
    expect(gameState.players.player3.score).toBe(2); // Was 1, now 2
    console.log("✅ Round 2 complete, auto-transitioned to round 3");
    console.log(`   Scores: P1=${gameState.players.player1.score}, P2=${gameState.players.player2.score}, P3=${gameState.players.player3.score}`);
    
    // ========================================================================
    // ROUND 3: Final round - should transition to finished
    // ========================================================================
    console.log("\n" + "=".repeat(80));
    console.log("ROUND 3 (FINAL)");
    console.log("=".repeat(80));
    
    // Player 1 plays scissors
    console.log("\n--- Player 1: scissors ---");
    const r3p1Result = await invokeAction("player1", "scissors");
    
    gameState = JSON.parse(r3p1Result.gameState);
    expect(gameState.game.phase).toBe("playing");
    expect(gameState.game.currentRound).toBe(3);
    console.log("✅ Player 1 submitted scissors");
    
    // Player 2 plays scissors (tie)
    console.log("\n--- Player 2: scissors ---");
    const r3p2Result = await invokeAction("player2", "scissors");
    
    gameState = JSON.parse(r3p2Result.gameState);
    expect(gameState.game.phase).toBe("playing");
    console.log("✅ Player 2 submitted scissors");
    
    // Player 3 plays rock - triggers scoring -> finished (game over)
    console.log("\n--- Player 3: rock (triggers final scoring) ---");
    const r3p3Result = await invokeAction("player3", "rock");
    
    gameState = JSON.parse(r3p3Result.gameState);
    console.log("Final state:", JSON.stringify(gameState, null, 2));
    
    // Should have transitioned to finished
    expect(gameState.game.phase).toBe("finished");
    expect(gameState.game.gameEnded).toBe(true);
    expect(r3p3Result.requiresPlayerInput).toBe(false);
    
    // Check final scores (player3 wins round 3: rock beats scissors)
    expect(gameState.players.player3.score).toBe(3); // Was 2, now 3
    console.log("✅ All rounds complete, game finished");
    console.log(`   Final Scores: P1=${gameState.players.player1.score}, P2=${gameState.players.player2.score}, P3=${gameState.players.player3.score}`);
    console.log(`   Winner: Player 3 with ${gameState.players.player3.score} points!`);
    
    // ========================================================================
    // VERIFICATION: Ensure proper cascading transitions occurred
    // ========================================================================
    console.log("\n" + "=".repeat(80));
    console.log("VERIFICATION");
    console.log("=".repeat(80));
    
    expect(gameState.game.currentRound).toBe(3); // Stayed at 3 (not incremented in final scoring)
    expect(gameState.game.totalRounds).toBe(3);
    expect(gameState.game.phase).toBe("finished");
    expect(gameState.game.gameEnded).toBe(true);
    
    // Verify winner
    const scores = [
      gameState.players.player1.score,
      gameState.players.player2.score,
      gameState.players.player3.score
    ];
    const maxScore = Math.max(...scores);
    expect(gameState.players.player3.score).toBe(maxScore);
    
    console.log("\n✅ ALL TESTS PASSED");
    console.log("✅ Game properly initialized");
    console.log("✅ All 9 player actions processed (3 players × 3 rounds)");
    console.log("✅ Automatic transitions worked: playing → scoring → playing (×2)");
    console.log("✅ Final transition worked: playing → scoring → finished");
    console.log("✅ Game ended in correct state");
    console.log("✅ Winner determined correctly");
    console.log("=".repeat(80) + "\n");
    
  }, 180000); // 3 minutes timeout (9 player actions + transitions)
});
