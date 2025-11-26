/**
 * Tests for Route Phase Node
 * 
 * Validates phase detection and instruction selection
 */

import { describe, it, expect } from "@jest/globals";
import { routePhase } from "../graphs/runtime-graph/nodes/route-phase/index.js";
import { setupSimulationModel } from "#chaincraft/ai/model-config.js";

describe("Route Phase Node", () => {
  it("should detect phase and select appropriate instructions", async () => {
    // Setup model
    const model = await setupSimulationModel();
    const routeFn = routePhase(model);
    
    // Sample game rules from RPS
    const gameRules = `3-Player Rock-Paper-Scissors Tournament is played over exactly 3 rounds with 3 players. 
The game begins in "playing" phase. Each round players simultaneously choose rock, paper, or scissors.
After all players submit moves, the game transitions to "scoring" phase to calculate winners.
After scoring, if currentRound < 3, return to "playing" for next round.
After round 3, game transitions to "finished" phase and gameEnded = true.`;
    
    // Sample state schema
    const stateSchema = JSON.stringify([
      {
        name: "game",
        type: "object",
        properties: {
          phase: { type: "string" },
          currentRound: { type: "number" },
          gameEnded: { type: "boolean" }
        }
      },
      {
        name: "players",
        type: "object"
      }
    ]);
    
    // Sample transitions
    const stateTransitions = `GAME PHASES:
1. PLAYING: Players submit moves simultaneously
2. SCORING: Calculate round results
3. FINISHED: Game concluded

PHASE TRANSITIONS:

FROM: PLAYING
TO: SCORING
TRIGGER_TYPE: PLAYER_ACTION
TRIGGER: All players have submitted moves

FROM: SCORING
TO: PLAYING
TRIGGER_TYPE: AUTOMATIC
TRIGGER: Current round < 3

FROM: SCORING
TO: FINISHED
TRIGGER_TYPE: AUTOMATIC
TRIGGER: Completed 3 rounds`;
    
    // Phase instructions
    const phaseInstructions = {
      "playing": "PLAYING PHASE: Wait for all players to submit rock/paper/scissors moves. Track submissions in game.currentRoundMoves.",
      "scoring": "SCORING PHASE: Calculate winners based on rock-paper-scissors rules. Update player scores. Check if game should end.",
      "finished": "FINISHED PHASE: Game is complete. Display final scores and winner. Reject all actions."
    };
    
    // Test Case 1: Playing phase (requires input)
    console.log("\n=== Test Case 1: Playing Phase ===");
    const playingState = JSON.stringify({
      game: {
        phase: "playing",
        currentRound: 1,
        currentRoundMoves: {},
        gameEnded: false
      },
      players: {
        player1: { totalScore: 0 },
        player2: { totalScore: 0 },
        player3: { totalScore: 0 }
      }
    });
    
    const result1 = await routeFn({
      gameRules,
      stateSchema,
      stateTransitions,
      phaseInstructions,
      gameState: playingState,
      players: ["player1", "player2", "player3"],
      isInitialized: true,
      currentPhase: "",
      selectedInstructions: "",
      requiresPlayerInput: true,
      transitionReady: false,
      nextPhase: "",
      plannedChanges: "",
      playerAction: undefined,
    });
    
    console.log(`Phase detected: ${result1.currentPhase}`);
    console.log(`Requires input: ${result1.requiresPlayerInput}`);
    console.log(`Transition ready: ${result1.transitionReady}`);
    console.log(`Instructions length: ${result1.selectedInstructions?.length} chars`);
    
    expect(result1.currentPhase).toBe("playing");
    expect(result1.requiresPlayerInput).toBe(true);
    expect(result1.transitionReady).toBe(false); // No moves submitted yet
    expect(result1.selectedInstructions).toContain("PLAYING PHASE");
    
    // Test Case 2: Scoring phase (automatic)
    console.log("\n=== Test Case 2: Scoring Phase ===");
    const scoringState = JSON.stringify({
      game: {
        phase: "scoring",
        currentRound: 2,
        currentRoundMoves: { player1: "rock", player2: "paper", player3: "scissors" },
        gameEnded: false
      },
      players: {
        player1: { totalScore: 1 },
        player2: { totalScore: 2 },
        player3: { totalScore: 0 }
      }
    });
    
    const result2 = await routeFn({
      gameRules,
      stateSchema,
      stateTransitions,
      phaseInstructions,
      gameState: scoringState,
      players: ["player1", "player2", "player3"],
      isInitialized: true,
      currentPhase: "",
      selectedInstructions: "",
      requiresPlayerInput: true,
      transitionReady: false,
      nextPhase: "",
      plannedChanges: "",
      playerAction: undefined,
    });
    
    console.log(`Phase detected: ${result2.currentPhase}`);
    console.log(`Requires input: ${result2.requiresPlayerInput}`);
    console.log(`Transition ready: ${result2.transitionReady}`);
    if (result2.transitionReady) {
      console.log(`Next phase: ${result2.nextPhase}`);
    }
    console.log(`Instructions length: ${result2.selectedInstructions?.length} chars`);
    
    expect(result2.currentPhase).toBe("scoring");
    expect(result2.requiresPlayerInput).toBe(false);
    expect(result2.transitionReady).toBe(true); // Should transition to playing (round 2)
    expect(result2.nextPhase).toBe("playing");
    expect(result2.selectedInstructions).toContain("SCORING PHASE");
    
    // Test Case 3: Finished phase (no input)
    console.log("\n=== Test Case 3: Finished Phase ===");
    const finishedState = JSON.stringify({
      game: {
        phase: "finished",
        currentRound: 3,
        gameEnded: true
      },
      players: {
        player1: { totalScore: 2 },
        player2: { totalScore: 3 },
        player3: { totalScore: 1 }
      }
    });
    
    const result3 = await routeFn({
      gameRules,
      stateSchema,
      stateTransitions,
      phaseInstructions,
      gameState: finishedState,
      players: ["player1", "player2", "player3"],
      isInitialized: true,
      currentPhase: "",
      selectedInstructions: "",
      requiresPlayerInput: true,
      transitionReady: false,
      nextPhase: "",
      plannedChanges: "",
      playerAction: undefined,
    });
    
    console.log(`Phase detected: ${result3.currentPhase}`);
    console.log(`Requires input: ${result3.requiresPlayerInput}`);
    console.log(`Transition ready: ${result3.transitionReady}`);
    console.log(`Instructions length: ${result3.selectedInstructions?.length} chars`);
    
    expect(result3.currentPhase).toBe("finished");
    expect(result3.requiresPlayerInput).toBe(false);
    expect(result3.transitionReady).toBe(false); // No transitions from finished
    expect(result3.selectedInstructions).toContain("FINISHED PHASE");
    
    console.log("\n=== Route Phase Test Complete ===");
    console.log("✅ All phase detection scenarios validated");
  }, 90000); // 90s timeout for LLM calls
});
