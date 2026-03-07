/**
 * Execute Changes Node Tests
 * 
 * Tests the execute node with different instruction scenarios using fixture mappings.
 * When fixtures regenerate with different names, update fixture-mappings.ts instead of this file.
 * 
 * Tests:
 * 1. Init transition (deterministic, no templates)
 * 2. Deterministic transition with templates
 * 3. Non-deterministic transition with mechanicsGuidance
 */

import { describe, it, expect, beforeAll } from "@jest/globals";
import { executeChanges } from "../index.js";
import { setupSimulationModel } from "#chaincraft/ai/model-config.js";
import type { RuntimeStateType } from "../../../runtime-state.js";
import { readFileSync } from "fs";
import { join } from "path";
import { FixtureHelper } from "#chaincraft/ai/simulate/test/fixtures/fixture-helper.js";
import { rpsMapping } from "#chaincraft/ai/simulate/test/fixtures/fixture-mappings.js";

describe("Execute Changes Node", () => {
  let model: Awaited<ReturnType<typeof setupSimulationModel>>;
  let executeNode: ReturnType<typeof executeChanges>;
  let rpsArtifacts: any;
  let helper: FixtureHelper;

  beforeAll(async () => {
    model = await setupSimulationModel();
    executeNode = executeChanges(model);
    
    // Load RPS fixture
    const fixturePathRps = join(
      process.cwd(),
      "src/ai/simulate/test/fixtures/games/rps/artifacts.json"
    );
    rpsArtifacts = JSON.parse(readFileSync(fixturePathRps, "utf-8"));
    helper = new FixtureHelper(rpsArtifacts, rpsMapping);
  });
  
  describe("Initialize Transition (Deterministic)", () => {
    it("should execute initialize_game transition", async () => {
      console.log("\n=== TEST: Initialize Game (Deterministic) ===");
      
      // Use helper to get transition instructions
      const initInstructions = helper.getTransitionInstructions("initialize");
      
      // Create initial state using helper
      const initialState = helper.createGameState({
        phase: helper.getInitPhase(),
      });
      initialState.players = {
        player1: helper.createPlayerState(),
        player2: helper.createPlayerState(),
      };

      const state: Partial<RuntimeStateType> = {
        gameState: JSON.stringify(initialState),
        selectedInstructions: JSON.stringify(initInstructions),
        playerMapping: JSON.stringify({ player1: "player1", player2: "player2" }),
        players: ["player1", "player2"],
        nextPhase: "submit", // Target phase after this transition
      };

      console.log("Initial state:", initialState);
      console.log("Instructions:", initInstructions);

      const result = await executeNode(state as RuntimeStateType);

      expect(result.gameState).toBeDefined();
      const newState = JSON.parse(result.gameState!);
      
      console.log("New state:", newState);

      // Verify state changes using helper
      expect(newState.game.gameEnded).toBe(false);
      // Note: initialize_game instruction sets phase to "submit" (schema name)
      // but transitions use "choice". This is a fixture inconsistency.
      expect(newState.game.currentPhase).toBe("submit");
      
      // Check player scores using mapping
      expect(helper.getPlayerField(newState.players.player1, "score")).toBe(0);
      expect(helper.getPlayerField(newState.players.player2, "score")).toBe(0);
      
      // Base schema fields (always same names)
      // actionsAllowed is optional, can be undefined or boolean
      expect(['boolean', 'undefined']).toContain(typeof newState.players.player1.actionsAllowed);
      expect(['boolean', 'undefined']).toContain(typeof newState.players.player2.actionsAllowed);
      expect(newState.players.player1.actionRequired).toBeDefined();
      expect(newState.players.player2.actionRequired).toBeDefined();
      
      console.log("✅ Initialize transition executed successfully");
    });
  });

  describe("Player Action Transition", () => {
    it("should execute both_choices_submitted transition", async () => {
      console.log("\n=== TEST: Both Choices Submitted ===");
      
      const transitionInstructions = helper.getTransitionInstructions("playerAction");
      
      // State after both players submitted their choices
      const gameState = helper.createGameState({
        phase: helper.getFirstActivePhase(),
      });
      helper.setGameField(gameState.game, "round", 1);
      gameState.players = {
        player1: helper.createPlayerState({ 
          score: 0,
          choice: "rock"
        }),
        player2: helper.createPlayerState({ 
          score: 0,
          choice: "paper"
        }),
      };

      const state: Partial<RuntimeStateType> = {
        gameState: JSON.stringify(gameState),
        selectedInstructions: JSON.stringify(transitionInstructions),
        playerMapping: JSON.stringify({ player1: "player1", player2: "player2" }),
        players: ["player1", "player2"],
        nextPhase: helper.getResolvePhase(),
      };

      console.log("Current state:", gameState);
      console.log("Instructions:", transitionInstructions);

      const result = await executeNode(state as RuntimeStateType);

      expect(result.gameState).toBeDefined();
      const newState = JSON.parse(result.gameState!);
      
      console.log("New state:", newState);

      // Verify phase transition to resolve phase
      expect(newState.game.currentPhase).toBe(helper.getResolvePhase());
      
      console.log("✅ Player action transition executed successfully");
    });
  });

  describe("Resolve Round (Non-Deterministic with Mechanics)", () => {
    it("should resolve round with winner (rock beats scissors)", async () => {
      console.log("\n=== TEST: Resolve Round - Rock Beats Scissors ===");
      
      const transitionInstructions = helper.getTransitionInstructions("playerAction");
      
      // State in choice phase with both players having submitted moves
      const gameState = helper.createGameState({
        phase: helper.getFirstActivePhase(),
      });
      helper.setGameField(gameState.game, "round", 1);
      gameState.players = {
        player1: helper.createPlayerState({ 
          score: 0,
          choice: "rock"
        }),
        player2: helper.createPlayerState({ 
          score: 0,
          choice: "scissors"
        }),
      };

      const state: Partial<RuntimeStateType> = {
        gameState: JSON.stringify(gameState),
        selectedInstructions: JSON.stringify(transitionInstructions),
        playerMapping: JSON.stringify({ player1: "player1", player2: "player2" }),
        players: ["player1", "player2"],
        nextPhase: helper.getResolvePhase(),
      };

      console.log("Current state:", gameState);
      console.log("Instructions mechanics:", JSON.parse(transitionInstructions).mechanicsGuidance);

      const result = await executeNode(state as RuntimeStateType);

      expect(result.gameState).toBeDefined();
      const newState = JSON.parse(result.gameState!);
      
      console.log("New state:", newState);

      // Verify mechanics were applied correctly - rock beats scissors
      expect(helper.getPlayerField(newState.players.player1, "score")).toBe(1);
      expect(helper.getPlayerField(newState.players.player2, "score")).toBe(0);
      
      // Should transition to resolve phase
      expect(newState.game.currentPhase).toBe(helper.getResolvePhase()!);
      
      // Round should stay the same (transition to resolve, not next round)
      expect(helper.getGameField(newState.game, "round")).toBe(1);
      
      console.log("✅ Resolve round with winner executed successfully");
    });

    it("should handle tie correctly (rock vs rock)", async () => {
      console.log("\n=== TEST: Resolve Round - Tie ===");
      
      const transitionInstructions = helper.getTransitionInstructions("playerAction");
      
      // State with both players choosing the same in choice phase
      const gameState = helper.createGameState({
        phase: helper.getFirstActivePhase(),
      });
      helper.setGameField(gameState.game, "round", 1);
      gameState.players = {
        player1: helper.createPlayerState({ 
          score: 0,
          choice: "rock"
        }),
        player2: helper.createPlayerState({ 
          score: 0,
          choice: "rock"
        }),
      };

      const state: Partial<RuntimeStateType> = {
        gameState: JSON.stringify(gameState),
        selectedInstructions: JSON.stringify(transitionInstructions),
        playerMapping: JSON.stringify({ player1: "player1", player2: "player2" }),
        players: ["player1", "player2"],
        nextPhase: helper.getResolvePhase(),
      };

      console.log("Current state (tie):", gameState);

      const result = await executeNode(state as RuntimeStateType);

      expect(result.gameState).toBeDefined();
      const newState = JSON.parse(result.gameState!);
      
      console.log("New state (tie):", newState);

      // Verify tie - no score change
      expect(helper.getPlayerField(newState.players.player1, "score")).toBe(0);
      expect(helper.getPlayerField(newState.players.player2, "score")).toBe(0);
      
      // Should transition to resolve phase
      expect(newState.game.currentPhase).toBe(helper.getResolvePhase()!);
      expect(helper.getGameField(newState.game, "round")).toBe(1);
      
      console.log("✅ Tie handled correctly");
    });

    it("should handle paper beats rock", async () => {
      console.log("\n=== TEST: Resolve Round - Paper Beats Rock ===");
      
      const transitionInstructions = helper.getTransitionInstructions("playerAction");
      
      const gameState = helper.createGameState({
        phase: helper.getFirstActivePhase(),
      });
      helper.setGameField(gameState.game, "round", 2);
      gameState.players = {
        player1: helper.createPlayerState({ 
          score: 1,
          choice: "rock"
        }),
        player2: helper.createPlayerState({ 
          score: 0,
          choice: "paper"
        }),
      };

      const state: Partial<RuntimeStateType> = {
        gameState: JSON.stringify(gameState),
        selectedInstructions: JSON.stringify(transitionInstructions),
        playerMapping: JSON.stringify({ player1: "player1", player2: "player2" }),
        players: ["player1", "player2"],
        nextPhase: helper.getResolvePhase(),
      };

      const result = await executeNode(state as RuntimeStateType);

      expect(result.gameState).toBeDefined();
      const newState = JSON.parse(result.gameState!);
      
      console.log("New state:", newState);

      // Paper beats rock - player2 should win
      expect(helper.getPlayerField(newState.players.player1, "score")).toBe(1);
      expect(helper.getPlayerField(newState.players.player2, "score")).toBe(1);
      
      expect(newState.game.currentPhase).toBe(helper.getResolvePhase()!);
      expect(helper.getGameField(newState.game, "round")).toBe(2);
      
      console.log("✅ Paper beats rock executed correctly");
    });
  });

  describe("Narrative Expansion", () => {
    it("should expand narrative markers and LLM should use them for message generation", async () => {
      console.log("\n=== TEST: Narrative Expansion with Message Generation ===");
      
      // Create an instruction that references a narrative marker in mechanicsGuidance
      const instructionsWithNarrative = {
        id: "reveal_winner",
        transitionName: "Reveal Round Winner",
        description: "Reveal choices and declare winner with dramatic flair",
        priority: 1,
        trigger: {
          preconditions: {
            "and": [
              { "var": "players.p1.currentChoice" },
              { "var": "players.p2.currentChoice" }
            ]
          }
        },
        mechanicsGuidance: {
          rules: [
            "Rock beats scissors",
            "Scissors beats paper", 
            "Paper beats rock",
            "!___ NARRATIVE:DRAMATIC_REVEAL ___!"
          ],
          computation: "Compare choices using RPS rules and generate dramatic reveal following narrative guidance"
        },
        stateDelta: [
          {
            op: "set",
            path: "game.currentPhase",
            value: "reveal"
          }
        ],
        messages: {
          public: {
            to: "all",
            template: "Round {{game.roundNumber}}: {{outcome}}"
          }
        },
        requiredStateFields: [
          "players.p1.currentChoice",
          "players.p2.currentChoice",
          "game.roundNumber"
        ]
      };
      
      // Narrative content that should influence message generation
      const narratives = {
        "DRAMATIC_REVEAL": `When revealing round results, use dramatic, epic language befitting a mystical arena battle. 
        
Examples:
- "The warriors clash! {{winner}}'s {{winningMove}} CRUSHES {{loser}}'s {{losingMove}}!"
- "Steel meets stone! {{winner}} emerges victorious as {{winningMove}} dominates {{losingMove}}!"
- "The arena trembles! {{winner}}'s choice of {{winningMove}} proves superior!"

Avoid bland announcements. Make every reveal feel like an epic moment in an ancient contest of champions.`
      };
      
      const gameState = helper.createGameState({
        phase: helper.getFirstActivePhase(),
      });
      helper.setGameField(gameState.game, "round", 1);
      gameState.players = {
        player1: helper.createPlayerState({ 
          score: 0,
          choice: "rock"
        }),
        player2: helper.createPlayerState({ 
          score: 0,
          choice: "scissors"
        }),
      };

      const state: Partial<RuntimeStateType> = {
        gameState: JSON.stringify(gameState),
        selectedInstructions: JSON.stringify(instructionsWithNarrative),
        playerMapping: JSON.stringify({ player1: "player1", player2: "player2" }),
        players: ["player1", "player2"],
        nextPhase: "reveal",
        specNarratives: narratives,
      };

      console.log("Narrative marker in guidance:", instructionsWithNarrative.mechanicsGuidance.rules[3]);
      console.log("Narrative content (first 100 chars):", narratives.DRAMATIC_REVEAL.substring(0, 100) + "...");

      const result = await executeNode(state as RuntimeStateType);

      expect(result.gameState).toBeDefined();
      const newState = JSON.parse(result.gameState!);
      
      const joinedPublicMessage = (newState.game.publicMessages as string[])?.join('\n\n') ?? newState.game.publicMessage ?? '';
      console.log("Generated public message:", joinedPublicMessage);

      // Verify the message has dramatic/epic language (influenced by narrative)
      const message = joinedPublicMessage.toLowerCase();
      
      // Check for dramatic language indicators from the narrative guidance
      const hasDramaticLanguage = 
        message.includes("clash") || 
        message.includes("crush") ||
        message.includes("dominate") ||
        message.includes("emerge") ||
        message.includes("victorious") ||
        message.includes("superior") ||
        message.includes("trembl") ||
        message.includes("arena") ||
        message.includes("warrior") ||
        message.includes("champion") ||
        // Also accept if it just has more elaborate phrasing than plain "rock beats scissors"
        (message.length > 50 && !message.match(/^round \d+.*rock beats scissors\.?$/i));
      
      console.log("Message shows dramatic influence:", hasDramaticLanguage);
      console.log("Message length:", message.length, "(plain message would be ~25 chars)");
      
      // The key test: verify LLM used the narrative guidance
      expect(hasDramaticLanguage).toBe(true);
      expect(newState.game.currentPhase).toBe("reveal");
      
      console.log("✅ LLM successfully used expanded narrative guidance for message generation");
    });

    it("should work without narratives (backward compatibility)", async () => {
      console.log("\n=== TEST: Execute Without Narratives ===");
      
      // Instructions without any narrative markers
      const instructionsWithoutNarratives = helper.getTransitionInstructions("initialize");
      
      const initialState = helper.createGameState({
        phase: helper.getInitPhase(),
      });
      initialState.players = {
        player1: helper.createPlayerState(),
        player2: helper.createPlayerState(),
      };

      const state: Partial<RuntimeStateType> = {
        gameState: JSON.stringify(initialState),
        selectedInstructions: JSON.stringify(instructionsWithoutNarratives),
        playerMapping: JSON.stringify({ player1: "player1", player2: "player2" }),
        players: ["player1", "player2"],
        nextPhase: "submit",
        // No specNarratives field - should work fine
      };

      console.log("Executing without narratives");

      const result = await executeNode(state as RuntimeStateType);

      expect(result.gameState).toBeDefined();
      const newState = JSON.parse(result.gameState!);
      
      console.log("New state (no narratives):", newState);

      // Verify normal execution works
      expect(newState.game.gameEnded).toBe(false);
      expect(newState.game.currentPhase).toBe("submit");
      
      console.log("✅ Backward compatibility maintained");
    });
  });

  describe("Image Prompt Generation", () => {
    it("should generate imagePrompt when transition instructions contain imageContentSpec", async () => {
      console.log("\n=== TEST: Image Prompt Generation from imageContentSpec ===");

      // Transition instruction with imageContentSpec — simulates a game-end reveal
      const instructionsWithImageSpec = {
        id: "end-game",
        transitionName: "Game Over - Reveal Champion",
        mechanicsGuidance: {
          rules: [
            "Rock beats scissors",
            "Scissors beats paper",
            "Paper beats rock",
          ],
          computation: "The player with the highest score is the overall champion",
        },
        stateDelta: [
          { op: "set", path: "game.phase", value: "finished" },
          { op: "set", path: "game.gameEnded", value: true },
          { op: "set", path: "players.{{winnerId}}.isGameWinner", value: true },
        ],
        messages: {
          public: {
            template: "{{winnerName}} wins the match! Final score: {{p1Score}}-{{p2Score}}.",
          },
        },
        imageContentSpec:
          "The champion raises their fist in victory after winning the Rock Paper Scissors match. Show them celebrating triumphantly in a game arena.",
      };

      // Game state: player1 wins with score 3-1
      const gameState = helper.createGameState({ phase: "reveal" });
      helper.setGameField(gameState.game, "round", 3);
      gameState.players = {
        player1: helper.createPlayerState({ score: 3, choice: "rock" }),
        player2: helper.createPlayerState({ score: 1, choice: "scissors" }),
      };

      const state: Partial<RuntimeStateType> = {
        gameState: JSON.stringify(gameState),
        selectedInstructions: JSON.stringify(instructionsWithImageSpec),
        playerMapping: JSON.stringify({ player1: "player1", player2: "player2" }),
        players: ["player1", "player2"],
        nextPhase: "finished",
      };

      const result = await executeNode(state as RuntimeStateType);

      // Core state assertions
      expect(result.gameState).toBeDefined();
      const newState = JSON.parse(result.gameState!);
      expect(newState.game.currentPhase).toBe("finished");

      // Key assertion: imagePrompt should be populated
      console.log("imagePrompt:", result.imagePrompt);
      expect(result.imagePrompt).toBeDefined();
      expect(typeof result.imagePrompt).toBe("string");
      expect(result.imagePrompt!.length).toBeGreaterThan(20);

      // Should reference actual game context (player names or outcomes)
      const prompt = result.imagePrompt!.toLowerCase();
      const hasContext =
        prompt.includes("player") ||
        prompt.includes("champion") ||
        prompt.includes("victor") ||
        prompt.includes("win") ||
        prompt.includes("rock") ||
        prompt.includes("celebrat");
      expect(hasContext).toBe(true);

      console.log(`✅ imagePrompt generated (${result.imagePrompt!.length} chars): "${result.imagePrompt}"`);

      // End-to-end assertion: accumulated publicMessages array should contain the embedded image markdown
      const publicMessages = newState.game.publicMessages as string[] | undefined;
      const joinedMessage = publicMessages?.join('\n\n');
      console.log("publicMessages:", publicMessages);
      expect(publicMessages).toBeDefined();
      expect(Array.isArray(publicMessages)).toBe(true);
      expect(joinedMessage).toContain("![scene](");
      console.log("✅ Image URL embedded in publicMessages as Markdown");
    });

    it("should not generate imagePrompt when instructions have no imageContentSpec", async () => {
      console.log("\n=== TEST: No imagePrompt when imageContentSpec absent ===");

      const instructionsWithoutImageSpec = helper.getTransitionInstructions("initialize");

      const initialState = helper.createGameState({ phase: helper.getInitPhase() });
      initialState.players = {
        player1: helper.createPlayerState(),
        player2: helper.createPlayerState(),
      };

      const state: Partial<RuntimeStateType> = {
        gameState: JSON.stringify(initialState),
        selectedInstructions: JSON.stringify(instructionsWithoutImageSpec),
        playerMapping: JSON.stringify({ player1: "player1", player2: "player2" }),
        players: ["player1", "player2"],
        nextPhase: helper.getFirstActivePhase(),
      };

      const result = await executeNode(state as RuntimeStateType);

      expect(result.gameState).toBeDefined();
      // imagePrompt must be absent — no imageContentSpec in instructions
      expect(result.imagePrompt).toBeUndefined();

      console.log("✅ No imagePrompt generated when imageContentSpec is absent");
    });
  });

  describe("Public Message Accumulation (chained auto-transitions)", () => {
    it("should accumulate publicMessages across chained automatic transitions", async () => {
      console.log("\n=== TEST: Public Message Accumulation ===");

      // --- First transition: triggered by a player action (both_players_chose) ---
      // playerAction being set marks this as a new turn → publicMessages reset to []
      const roundResolveInstructions = {
        id: "both_players_chose",
        transitionName: "Resolve Round",
        mechanicsGuidance: {
          rules: ["Rock beats scissors", "Scissors beats paper", "Paper beats rock"],
          computation: "Compare the two choices and determine the winner",
        },
        stateDelta: [
          { op: "set", path: "players.{{winnerId}}.score", value: "{{winnerScore}}" },
        ],
        messages: {
          public: {
            template: "Round 1 result: {{winnerName}} wins with {{winnerChoice}} over {{loserChoice}}!",
          },
        },
      };

      const gameState1 = helper.createGameState({ phase: "choosing" });
      helper.setGameField(gameState1.game, "round", 1);
      gameState1.players = {
        player1: helper.createPlayerState({ score: 0, choice: "rock" }),
        player2: helper.createPlayerState({ score: 0, choice: "scissors" }),
      };

      const stateAfterAction: Partial<RuntimeStateType> = {
        gameState: JSON.stringify(gameState1),
        selectedInstructions: JSON.stringify(roundResolveInstructions),
        playerMapping: JSON.stringify({ player1: "player1", player2: "player2" }),
        players: ["player1", "player2"],
        nextPhase: "resolving",
        // playerAction present → isNewTurn = true → fresh publicMessages
        playerAction: { playerId: "player2", playerAction: "scissors" },
        isInitialized: true,
      };

      const result1 = await executeNode(stateAfterAction as RuntimeStateType);
      expect(result1.gameState).toBeDefined();
      const state1 = JSON.parse(result1.gameState!);

      console.log("After first transition publicMessages:", state1.game.publicMessages);
      expect(Array.isArray(state1.game.publicMessages)).toBe(true);
      expect(state1.game.publicMessages.length).toBe(1);
      expect(state1.game.publicMessages[0]).toBeTruthy();
      console.log(`  [1]: "${state1.game.publicMessages[0]}"`);

      // --- Second transition: automatic chain (continue_to_next_round) ---
      // No playerAction, isInitialized = true → isNewTurn = false → append to existing messages
      const nextRoundInstructions = {
        id: "continue_to_next_round",
        transitionName: "Start Next Round",
        mechanicsGuidance: null,
        stateDelta: [
          { op: "increment", path: "game.roundNumber", value: 1 },
          { op: "setForAllPlayers", field: "currentChoice", value: null },
          { op: "setForAllPlayers", field: "actionRequired", value: true },
        ],
        messages: {
          public: {
            template: "Round 2 begins! Both players, submit your choices.",
          },
        },
      };

      const stateAfterChain: Partial<RuntimeStateType> = {
        gameState: result1.gameState!, // feed first result through
        selectedInstructions: JSON.stringify(nextRoundInstructions),
        playerMapping: JSON.stringify({ player1: "player1", player2: "player2" }),
        players: ["player1", "player2"],
        nextPhase: "choosing",
        playerAction: undefined, // cleared — auto transition
        isInitialized: true,
      };

      const result2 = await executeNode(stateAfterChain as RuntimeStateType);
      expect(result2.gameState).toBeDefined();
      const state2 = JSON.parse(result2.gameState!);

      console.log("After chained transition publicMessages:", state2.game.publicMessages);
      expect(Array.isArray(state2.game.publicMessages)).toBe(true);
      expect(state2.game.publicMessages.length).toBe(2);
      console.log(`  [1]: "${state2.game.publicMessages[0]}"`);
      console.log(`  [2]: "${state2.game.publicMessages[1]}"`);

      // The round-result message from the first transition must still be present
      expect(state2.game.publicMessages[0]).toBe(state1.game.publicMessages[0]);
      // The "next round" message must be the second entry
      expect(state2.game.publicMessages[1]).toBeTruthy();

      // publicMessage in game state must NOT be the pre-joined string —
      // joining is getRuntimeResponse's job at read-time, not execute-changes' job at write-time
      const joined = state2.game.publicMessages.join('\n\n');
      expect(state2.game.publicMessage).not.toBe(joined);

      console.log("✅ Both messages accumulated and correctly joined");
    });

    it("should reset publicMessages at the start of a new player turn", async () => {
      console.log("\n=== TEST: publicMessages reset on new player action ===");

      // Simulate state that already has accumulated messages from a previous turn
      const priorGameState = helper.createGameState({ phase: "choosing" });
      priorGameState.game.publicMessages = ["Old round message", "Old next-round message"];
      priorGameState.players = {
        player1: helper.createPlayerState({ score: 1, choice: null }),
        player2: helper.createPlayerState({ score: 0, choice: null }),
      };

      const roundResolveInstructions = {
        id: "both_players_chose",
        transitionName: "Resolve Round",
        mechanicsGuidance: {
          rules: ["Rock beats scissors", "Scissors beats paper", "Paper beats rock"],
          computation: "Compare the two choices and determine the winner",
        },
        stateDelta: [],
        messages: {
          public: { template: "Round 2 resolved: {{winnerId}} wins!" },
        },
      };

      priorGameState.players.player1.currentChoice = "rock";
      priorGameState.players.player2.currentChoice = "paper";

      const stateWithNewAction: Partial<RuntimeStateType> = {
        gameState: JSON.stringify(priorGameState),
        selectedInstructions: JSON.stringify(roundResolveInstructions),
        playerMapping: JSON.stringify({ player1: "player1", player2: "player2" }),
        players: ["player1", "player2"],
        nextPhase: "resolving",
        playerAction: { playerId: "player2", playerAction: "paper" }, // new action → reset
        isInitialized: true,
      };

      const result = await executeNode(stateWithNewAction as RuntimeStateType);
      expect(result.gameState).toBeDefined();
      const newState = JSON.parse(result.gameState!);

      console.log("publicMessages after new turn:", newState.game.publicMessages);
      // Should only have the one new message — old ones wiped
      expect(Array.isArray(newState.game.publicMessages)).toBe(true);
      expect(newState.game.publicMessages.length).toBe(1);
      // Must not contain any of the old messages
      expect(newState.game.publicMessages[0]).not.toContain("Old round message");

      console.log("✅ publicMessages correctly reset at start of new turn");
    });
  });
});
