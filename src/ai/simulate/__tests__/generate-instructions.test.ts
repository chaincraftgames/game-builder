/**
 * Tests for Generate Instructions Node
 * 
 * Validates that phase-specific instructions are correctly generated.
 */

import { describe, expect, it } from "@jest/globals";
import { generateInstructions } from "../graphs/spec-processing-graph/nodes/generate-instructions/index.js";
import { setupSpecProcessingModel } from "#chaincraft/ai/model-config.js";

describe("Generate Instructions Node", () => {
  it("should generate phase-specific instructions from game artifacts", async () => {
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
    "properties": {
      "phase": { "name": "phase", "type": "string" },
      "currentRound": { "name": "currentRound", "type": "number" },
      "gameEnded": { "name": "gameEnded", "type": "boolean" },
      "publicMessage": { "name": "publicMessage", "type": "string" }
    }
  },
  {
    "name": "players",
    "type": "object",
    "items": {
      "type": "object",
      "properties": {
        "totalScore": { "name": "totalScore", "type": "number" },
        "hasSubmittedMove": { "name": "hasSubmittedMove", "type": "boolean" },
        "privateMessage": { "name": "privateMessage", "type": "string" },
        "illegalActionCount": { "name": "illegalActionCount", "type": "number" },
        "actionsAllowed": { "name": "actionsAllowed", "type": "boolean" },
        "actionRequired": { "name": "actionRequired", "type": "boolean" }
      }
    }
  }
]`;

    const stateTransitions = `
GAME PHASES:
- playing: Active gameplay where players submit moves
- scoring: Final score calculation and winner determination
- finished: Terminal phase

PHASE TRANSITIONS:

FROM: playing
TO: scoring
TRIGGER: All players submitted moves and currentRound = 3
STATE CHECKS: game.currentRound = 3, all players.hasSubmittedMove = true

FROM: scoring
TO: finished
TRIGGER: Winner determined
STATE CHECKS: game.phase = "scoring"
SIDE EFFECTS: Set game.gameEnded = true
`;

    const model = await setupSpecProcessingModel();
    const generateFn = generateInstructions(model);

    const result = await generateFn({
      gameSpecification: "",
      gameRules,
      stateSchema,
      stateTransitions,
      phaseInstructions: {},
      exampleState: "",
    });

    console.log("\n=== Generated Instructions ===\n");
    
    // Validate structure
    expect(result.phaseInstructions).toBeDefined();
    expect(typeof result.phaseInstructions).toBe("object");
    
    const phases = Object.keys(result.phaseInstructions!);
    expect(phases.length).toBeGreaterThan(0);
    console.log(`✓ Generated instructions for ${phases.length} phases:`, phases);

    // Check each phase has substantial instructions
    phases.forEach(phase => {
      const instructions = result.phaseInstructions![phase];
      expect(instructions).toBeDefined();
      expect(typeof instructions).toBe("string");
      expect(instructions.length).toBeGreaterThan(200); // Should be substantial
      console.log(`✓ ${phase}: ${instructions.length} characters`);
    });

    // Check for key phases from the transitions
    const phaseLower = phases.map(p => p.toLowerCase());
    expect(phaseLower).toContain("playing");
    console.log("✓ Contains 'playing' phase instructions");

    // Check that instructions contain schema field references
    const allInstructions = phases.map(p => result.phaseInstructions![p]).join(" ");
    expect(allInstructions).toMatch(/game\.(phase|currentRound|gameEnded)/);
    console.log("✓ Instructions reference schema fields");

    // Check for action handling
    expect(allInstructions.toLowerCase()).toMatch(/action|move|submit/);
    console.log("✓ Instructions mention actions/moves");

    // Check for state update guidance
    expect(allInstructions.toLowerCase()).toMatch(/update|set|change/);
    console.log("✓ Instructions include state update guidance");

    // Print all instructions for manual review
    console.log("\n=== FULL GENERATED INSTRUCTIONS ===\n");
    phases.forEach(phase => {
      console.log(`\n========== ${phase.toUpperCase()} PHASE ==========\n`);
      console.log(result.phaseInstructions![phase]);
      console.log("\n" + "=".repeat(50) + "\n");
    });

    console.log("\n=== Generate Instructions Test Complete ===");
  }, 90000); // 90s timeout for LLM calls
});
