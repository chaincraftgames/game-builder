/**
 * Tests for Plan Changes Node
 * 
 * Validates planning for both player actions and phase transitions
 */

import { describe, it, expect } from "@jest/globals";
import { planChanges } from "../graphs/runtime-graph/nodes/plan-changes/index.js";
import { setupSimulationModel } from "#chaincraft/ai/model-config.js";

describe("Plan Changes Node", () => {
  // Sample game rules from RPS
  const gameRules = `3-Player Rock-Paper-Scissors Tournament is played over exactly 3 rounds with 3 players. 
The game begins in "playing" phase. Each round players simultaneously choose rock, paper, or scissors.
After all players submit moves, the game transitions to "scoring" phase to calculate winners.
After scoring, if currentRound < 3, return to "playing" for next round.
After round 3, game transitions to "finished" phase and gameEnded = true.`;
  
  const stateSchema = JSON.stringify([
    {
      name: "game",
      type: "object",
      properties: {
        phase: { type: "string" },
        currentRound: { type: "number" },
        currentRoundMoves: { type: "object" },
        gameEnded: { type: "boolean" }
      }
    },
    {
      name: "players",
      type: "object"
    }
  ]);
  
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
  
  const phaseInstructions = {
    "playing": `PLAYING PHASE: Wait for all players to submit rock/paper/scissors moves.

RULES:
- Accept moves: "rock", "paper", or "scissors"
- Store in game.currentRoundMoves as { playerId: move }
- When all 3 players submitted, transition to SCORING

PHASE TRANSITIONS:
- TO SCORING: When all players have submitted moves (currentRoundMoves has 3 entries)`,
    
    "scoring": `SCORING PHASE: Calculate winners based on rock-paper-scissors rules.

RULES:
- Rock beats Scissors
- Scissors beats Paper  
- Paper beats Rock
- Award 1 point to round winner(s)
- Increment game.currentRound
- Clear game.currentRoundMoves

PHASE TRANSITIONS:
- TO PLAYING: If currentRound < 3 (more rounds to play)
- TO FINISHED: If currentRound >= 3 (game complete, set gameEnded=true)`,
    
    "finished": `FINISHED PHASE: Game is complete.

RULES:
- Display final scores and winner
- Reject all player actions
- No transitions from this phase`
  };
  
  it("should plan player action in playing phase", async () => {
    console.log("\n=== Test Case 1: Plan Player Action ===");
    
    const model = await setupSimulationModel();
    const planFn = planChanges(model);
    
    const gameState = JSON.stringify({
      game: {
        phase: "playing",
        currentRound: 1,
        currentRoundMoves: { player1: "rock" },
        gameEnded: false
      },
      players: {
        player1: { totalScore: 0 },
        player2: { totalScore: 0 },
        player3: { totalScore: 0 }
      }
    });
    
    const result = await planFn({
      gameRules,
      stateSchema,
      stateTransitions,
      phaseInstructions,
      gameState,
      players: ["player1", "player2", "player3"],
      isInitialized: true,
      currentPhase: "playing",
      selectedInstructions: phaseInstructions.playing,
      requiresPlayerInput: true,
      transitionReady: false,
      nextPhase: "",
      plannedChanges: "",
      playerAction: {
        playerId: "player2",
        playerAction: "paper"
      },
    });
    
    console.log("Planned changes:");
    console.log(result.plannedChanges);
    
    expect(result.plannedChanges).toBeDefined();
    expect(typeof result.plannedChanges).toBe("string");
    expect(result.plannedChanges).toContain("player2"); // Should reference the player
    expect(result.plannedChanges?.toLowerCase()).toContain("paper"); // Should reference the action
    expect(result.plannedChanges?.toLowerCase()).toMatch(/currentroundmoves|moves/); // Should mention storing the move
    
    console.log("✅ Player action plan validated");
  }, 60000);
  
  it("should plan phase transition from scoring to playing", async () => {
    console.log("\n=== Test Case 2: Plan Transition (Scoring → Playing) ===");
    
    const model = await setupSimulationModel();
    const planFn = planChanges(model);
    
    const gameState = JSON.stringify({
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
    
    const result = await planFn({
      gameRules,
      stateSchema,
      stateTransitions,
      phaseInstructions,
      gameState,
      players: ["player1", "player2", "player3"],
      isInitialized: true,
      currentPhase: "scoring",
      selectedInstructions: phaseInstructions.scoring,
      requiresPlayerInput: false,
      transitionReady: true, // Indicates we should transition
      nextPhase: "playing",
      plannedChanges: "",
      playerAction: undefined,
    });
    
    console.log("Planned changes:");
    console.log(result.plannedChanges);
    
    expect(result.plannedChanges).toBeDefined();
    expect(typeof result.plannedChanges).toBe("string");
    expect(result.plannedChanges?.toLowerCase()).toContain("phase"); // Should mention phase change
    expect(result.plannedChanges?.toLowerCase()).toContain("playing"); // Should mention target phase
    expect(result.plannedChanges?.toLowerCase()).toMatch(/clear|reset|empty/); // Should mention clearing moves
    expect(result.transitionReady).toBe(false); // Should clear the flag
    
    console.log("✅ Phase transition plan validated");
  }, 60000);
  
  it("should plan phase transition from scoring to finished", async () => {
    console.log("\n=== Test Case 3: Plan Transition (Scoring → Finished) ===");
    
    const model = await setupSimulationModel();
    const planFn = planChanges(model);
    
    const gameState = JSON.stringify({
      game: {
        phase: "scoring",
        currentRound: 3,
        currentRoundMoves: { player1: "rock", player2: "paper", player3: "scissors" },
        gameEnded: false
      },
      players: {
        player1: { totalScore: 2 },
        player2: { totalScore: 3 },
        player3: { totalScore: 1 }
      }
    });
    
    const result = await planFn({
      gameRules,
      stateSchema,
      stateTransitions,
      phaseInstructions,
      gameState,
      players: ["player1", "player2", "player3"],
      isInitialized: true,
      currentPhase: "scoring",
      selectedInstructions: phaseInstructions.scoring,
      requiresPlayerInput: false,
      transitionReady: true,
      nextPhase: "finished",
      plannedChanges: "",
      playerAction: undefined,
    });
    
    console.log("Planned changes:");
    console.log(result.plannedChanges);
    
    expect(result.plannedChanges).toBeDefined();
    expect(typeof result.plannedChanges).toBe("string");
    expect(result.plannedChanges?.toLowerCase()).toContain("phase");
    expect(result.plannedChanges?.toLowerCase()).toContain("finished");
    expect(result.plannedChanges?.toLowerCase()).toMatch(/gameended|game.*ended/); // Should set gameEnded
    expect(result.transitionReady).toBe(false); // Should clear the flag
    
    console.log("✅ Game end transition plan validated");
  }, 60000);
  
  it("should handle invalid state (no action or transition)", async () => {
    console.log("\n=== Test Case 4: No Action or Transition ===");
    
    const model = await setupSimulationModel();
    const planFn = planChanges(model);
    
    const gameState = JSON.stringify({
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
    
    const result = await planFn({
      gameRules,
      stateSchema,
      stateTransitions,
      phaseInstructions,
      gameState,
      players: ["player1", "player2", "player3"],
      isInitialized: true,
      currentPhase: "playing",
      selectedInstructions: phaseInstructions.playing,
      requiresPlayerInput: true,
      transitionReady: false, // No transition
      nextPhase: "",
      plannedChanges: "",
      playerAction: undefined, // No action
    });
    
    console.log("Planned changes:");
    console.log(result.plannedChanges);
    
    expect(result.plannedChanges).toBeDefined();
    expect(result.plannedChanges?.toLowerCase()).toContain("no");
    
    console.log("✅ No-op case handled correctly");
  }, 10000);
  
  console.log("\n=== Plan Changes Tests Complete ===");
});
