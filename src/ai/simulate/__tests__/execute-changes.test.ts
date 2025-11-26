/**
 * Tests for Execute Changes Node
 * 
 * Validates JSON formatting and schema validation
 */

import { describe, it, expect } from "@jest/globals";
import { executeChanges } from "../graphs/runtime-graph/nodes/execute-changes/index.js";
import { setupSimulationModel } from "#chaincraft/ai/model-config.js";

describe("Execute Changes Node", () => {
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
      type: "object",
      patternProperties: {
        "^player[0-9]+$": {
          type: "object",
          properties: {
            totalScore: { type: "number" }
          }
        }
      }
    }
  ]);
  
  it("should execute player action changes", async () => {
    console.log("\n=== Test Case 1: Execute Player Action ===");
    
    const model = await setupSimulationModel();
    const executeFn = executeChanges(model);
    
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
    
    const plannedChanges = `ACTION VALIDITY: Valid move (paper is a legal choice)
STATE UPDATES:
- game.currentRoundMoves.player2 = "paper"
SIDE EFFECTS: None yet (waiting for player3)
MESSAGES: "Player 2 submitted paper. Waiting for Player 3."`;
    
    const result = await executeFn({
      gameRules,
      stateSchema,
      stateTransitions: "",
      phaseInstructions: {},
      gameState,
      players: ["player1", "player2", "player3"],
      isInitialized: true,
      currentPhase: "playing",
      selectedInstructions: "",
      requiresPlayerInput: true,
      transitionReady: false,
      nextPhase: "",
      plannedChanges,
      playerAction: {
        playerId: "player2",
        playerAction: "paper"
      },
    });
    
    console.log("Executed state:");
    console.log(result.gameState);
    
    expect(result.gameState).toBeDefined();
    expect(typeof result.gameState).toBe("string");
    
    // Parse and validate structure
    const newState = JSON.parse(result.gameState!);
    expect(newState).toHaveProperty("game");
    expect(newState).toHaveProperty("players");
    expect(newState.game).toHaveProperty("phase");
    expect(newState.game).toHaveProperty("currentRound");
    expect(newState.game).toHaveProperty("currentRoundMoves");
    expect(newState.game).toHaveProperty("gameEnded");
    
    // Validate the change was applied
    expect(newState.game.currentRoundMoves).toHaveProperty("player2");
    expect(newState.game.currentRoundMoves.player2).toBe("paper");
    
    // Validate other state preserved
    expect(newState.game.phase).toBe("playing");
    expect(newState.game.currentRound).toBe(1);
    expect(newState.game.currentRoundMoves.player1).toBe("rock");
    
    // Validate playerAction cleared
    expect(result.playerAction).toBeUndefined();
    
    console.log("✅ Player action execution validated");
  }, 60000);
  
  it("should execute phase transition (scoring to playing)", async () => {
    console.log("\n=== Test Case 2: Execute Transition (Scoring → Playing) ===");
    
    const model = await setupSimulationModel();
    const executeFn = executeChanges(model);
    
    const gameState = JSON.stringify({
      game: {
        phase: "scoring",
        currentRound: 1,
        currentRoundMoves: { player1: "rock", player2: "paper", player3: "scissors" },
        gameEnded: false
      },
      players: {
        player1: { totalScore: 0 },
        player2: { totalScore: 1 }, // Won this round
        player3: { totalScore: 0 }
      }
    });
    
    const plannedChanges = `PHASE FIELD: game.phase = "playing"
RESET/CLEANUP: 
- Clear game.currentRoundMoves = {}
INITIALIZATION:
- game.currentRound already incremented to 2 during scoring
MESSAGES: "Starting round 2. Players, submit your moves!"`;
    
    const result = await executeFn({
      gameRules,
      stateSchema,
      stateTransitions: "",
      phaseInstructions: {},
      gameState,
      players: ["player1", "player2", "player3"],
      isInitialized: true,
      currentPhase: "scoring",
      selectedInstructions: "",
      requiresPlayerInput: false,
      transitionReady: false,
      nextPhase: "playing",
      plannedChanges,
      playerAction: undefined,
    });
    
    console.log("Executed state:");
    console.log(result.gameState);
    
    expect(result.gameState).toBeDefined();
    
    const newState = JSON.parse(result.gameState!);
    
    // Validate phase change
    expect(newState.game.phase).toBe("playing");
    
    // Validate cleanup
    expect(newState.game.currentRoundMoves).toEqual({});
    
    // Validate round preserved
    expect(newState.game.currentRound).toBe(2);
    
    // Validate scores preserved
    expect(newState.players.player2.totalScore).toBe(1);
    
    console.log("✅ Phase transition execution validated");
  }, 60000);
  
  it("should execute game end transition (scoring to finished)", async () => {
    console.log("\n=== Test Case 3: Execute Transition (Scoring → Finished) ===");
    
    const model = await setupSimulationModel();
    const executeFn = executeChanges(model);
    
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
    
    const plannedChanges = `PHASE FIELD: game.phase = "finished"
GAME END: game.gameEnded = true
RESET/CLEANUP: Clear game.currentRoundMoves = {}
MESSAGES: "Game complete! Player 2 wins with 3 points!"`;
    
    const result = await executeFn({
      gameRules,
      stateSchema,
      stateTransitions: "",
      phaseInstructions: {},
      gameState,
      players: ["player1", "player2", "player3"],
      isInitialized: true,
      currentPhase: "scoring",
      selectedInstructions: "",
      requiresPlayerInput: false,
      transitionReady: false,
      nextPhase: "finished",
      plannedChanges,
      playerAction: undefined,
    });
    
    console.log("Executed state:");
    console.log(result.gameState);
    
    expect(result.gameState).toBeDefined();
    
    const newState = JSON.parse(result.gameState!);
    
    // Validate phase change
    expect(newState.game.phase).toBe("finished");
    
    // Validate game end flag
    expect(newState.game.gameEnded).toBe(true);
    
    // Validate cleanup
    expect(newState.game.currentRoundMoves).toEqual({});
    
    // Validate final scores preserved
    expect(newState.players.player1.totalScore).toBe(2);
    expect(newState.players.player2.totalScore).toBe(3);
    expect(newState.players.player3.totalScore).toBe(1);
    
    console.log("✅ Game end execution validated");
  }, 60000);
  
  it("should maintain schema compliance with structured output", async () => {
    console.log("\n=== Test Case 4: Schema Validation ===");
    
    const model = await setupSimulationModel();
    const executeFn = executeChanges(model);
    
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
    
    const plannedChanges = `Add player1's move: game.currentRoundMoves.player1 = "rock"`;
    
    const result = await executeFn({
      gameRules,
      stateSchema,
      stateTransitions: "",
      phaseInstructions: {},
      gameState,
      players: ["player1", "player2", "player3"],
      isInitialized: true,
      currentPhase: "playing",
      selectedInstructions: "",
      requiresPlayerInput: true,
      transitionReady: false,
      nextPhase: "",
      plannedChanges,
      playerAction: {
        playerId: "player1",
        playerAction: "rock"
      },
    });
    
    expect(result.gameState).toBeDefined();
    
    // Should parse without error (structured output enforces schema)
    const newState = JSON.parse(result.gameState!);
    
    // Validate required fields exist
    expect(newState.game).toHaveProperty("phase");
    expect(newState.game).toHaveProperty("currentRound");
    expect(newState.game).toHaveProperty("currentRoundMoves");
    expect(newState.game).toHaveProperty("gameEnded");
    expect(newState).toHaveProperty("players");
    
    // Validate types
    expect(typeof newState.game.phase).toBe("string");
    expect(typeof newState.game.currentRound).toBe("number");
    expect(typeof newState.game.currentRoundMoves).toBe("object");
    expect(typeof newState.game.gameEnded).toBe("boolean");
    
    console.log("✅ Schema compliance validated");
  }, 60000);
  
  console.log("\n=== Execute Changes Tests Complete ===");
});
