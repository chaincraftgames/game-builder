/**
 * Tests for Extract Transitions Node
 * 
 * Validates that phase transitions are correctly extracted from game specifications.
 */

import { describe, expect, it } from "@jest/globals";
import { extractTransitions } from "../graphs/spec-processing-graph/nodes/extract-transitions/index.js";
import { setupSpecTransitionsModel } from "#chaincraft/ai/model-config.js";

describe("Extract Transitions Node", () => {
  it("should extract phase transitions from specification", async () => {
    // Use the RPS game rules and schema from extract-schema test
    const gameRules = `
Rock Paper Scissors is a game for 2-3 players that runs for 3 rounds.

SETUP:
- Each player starts with a score of 0
- Game begins in "playing" phase

GAMEPLAY (Playing Phase):
- Each round, players simultaneously choose: rock, paper, or scissors
- Once all players submit moves, the round is scored
- Rock beats scissors, scissors beats paper, paper beats rock
- Winner of each matchup gets 1 point
- After 3 rounds, transition to scoring phase

SCORING (Scoring Phase):
- Calculate total scores across all rounds
- Determine winner (highest score)
- If tie, all tied players share victory
- Transition to finished phase

FINISHED:
- Game ends with winner announced
- No further moves allowed
`;

    const stateSchema = `[
  {
    "name": "game",
    "type": "object",
    "description": "Core game state tracking rounds, moves, and outcomes",
    "properties": {
      "phase": {
        "name": "phase",
        "type": "string",
        "description": "Current game phase: playing, scoring, or finished"
      },
      "currentRound": {
        "name": "currentRound",
        "type": "number",
        "description": "Current round number (1-3)"
      },
      "gameEnded": {
        "name": "gameEnded",
        "type": "boolean",
        "description": "Whether the game has ended"
      }
    }
  },
  {
    "name": "players",
    "type": "object",
    "description": "Player-specific state keyed by player ID",
    "items": {
      "type": "object",
      "properties": {
        "totalScore": {
          "name": "totalScore",
          "type": "number",
          "description": "Total score across all rounds"
        },
        "hasSubmittedMove": {
          "name": "hasSubmittedMove",
          "type": "boolean",
          "description": "Whether player has submitted move this round"
        }
      }
    }
  }
]`;

    const model = await setupSpecTransitionsModel();
    const extractFn = extractTransitions(model);

    const result = await extractFn({
      gameSpecification: "", // Not used in this node
      gameRules,
      stateSchema: "",
      stateTransitions: "",
      phaseInstructions: {},
      exampleState: ""
    });

    console.log("\n=== Extracted Transitions ===\n");
    console.log(result.stateTransitions);
    console.log("\n=== Validation ===");

    // Validate structure
    expect(result.stateTransitions).toBeDefined();
    expect(typeof result.stateTransitions).toBe("string");
    expect(result.stateTransitions!.length).toBeGreaterThan(100);

    console.log(`✓ Transitions length: ${result.stateTransitions!.length} chars`);

    // Check for key sections
    const transitions = result.stateTransitions!;
    
    expect(transitions.toLowerCase()).toContain("phase");
    console.log("✓ Contains phase information");

    expect(transitions.toLowerCase()).toContain("transition");
    console.log("✓ Contains transition information");

    // Check for the three main phases mentioned in rules
    expect(transitions.toLowerCase()).toContain("playing");
    expect(transitions.toLowerCase()).toContain("scoring");
    expect(transitions.toLowerCase()).toContain("finished");
    console.log("✓ Contains all three phases (playing, scoring, finished)");

    // Check for state field references
    const hasPhaseField = transitions.includes("game.phase") || transitions.includes("phase");
    expect(hasPhaseField).toBe(true);
    console.log("✓ References phase state field");

    const hasGameEndedField = transitions.includes("gameEnded") || transitions.includes("game.gameEnded");
    expect(hasGameEndedField).toBe(true);
    console.log("✓ References gameEnded state field");

    // Check for transition logic
    const hasRoundLogic = transitions.includes("round") || transitions.includes("Round");
    expect(hasRoundLogic).toBe(true);
    console.log("✓ Contains round-based transition logic");

    console.log("\n=== Extract Transitions Test Complete ===");
  }, 60000); // 60s timeout for LLM calls
});
