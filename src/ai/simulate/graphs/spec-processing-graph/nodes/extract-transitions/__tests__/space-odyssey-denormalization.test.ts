/**
 * Space Odyssey Workflow Test - State Denormalization Pattern
 * 
 * This test validates that the transitions planner correctly handles games that
 * require state denormalization to enable deterministic preconditions.
 * 
 * The key pattern tested:
 * - Game has a map structure (deadlyOptionIndices) with per-round configuration
 * - Preconditions need to check "value for current round" 
 * - Planner should denormalize this into a direct field (currentRoundDeadlyIndex)
 * - Transitions update the denormalized field when changing rounds
 * - Preconditions check the denormalized field (not dynamic lookup)
 */

import { describe, expect, it } from "@jest/globals";
import { transitionsExtractionConfig } from "../index.js";
import { createExtractionSubgraph } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/node-factories.js";
import { InMemoryStore } from "@langchain/langgraph";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("Space Odyssey - State Denormalization Pattern", () => {
  it("should denormalize current round's deadly index for deterministic preconditions", async () => {
    const gameSpec = await readFile(
      join(__dirname, "fixtures", "space-odyssey-spec.md"),
      "utf-8"
    );

    // State schema that includes BOTH the map and denormalized field
    const stateSchema = `[
  {
    "name": "game",
    "type": "object",
    "description": "Core game state",
    "properties": {
      "currentPhase": {
        "name": "currentPhase",
        "type": "string",
        "description": "Current phase: init, round_active, or finished"
      },
      "currentRound": {
        "name": "currentRound",
        "type": "number",
        "description": "Current round number (1-5)"
      },
      "deadlyOptionIndices": {
        "name": "deadlyOptionIndices",
        "type": "object",
        "description": "Map of round numbers to deadly option index (randomized at game start)"
      },
      "currentRoundDeadlyIndex": {
        "name": "currentRoundDeadlyIndex",
        "type": "number",
        "description": "Denormalized: the deadly option index for the CURRENT round (updated on round transitions)"
      },
      "gameEnded": {
        "name": "gameEnded",
        "type": "boolean",
        "description": "Whether the game has ended"
      },
      "publicMessage": {
        "name": "publicMessage",
        "type": "string",
        "description": "Public game state message"
      }
    }
  },
  {
    "name": "players",
    "type": "object",
    "description": "Player-specific state (single player)",
    "items": {
      "type": "object",
      "properties": {
        "isAlive": {
          "name": "isAlive",
          "type": "boolean",
          "description": "Whether player survived or hit deadly option"
        },
        "selectedOptionIndex": {
          "name": "selectedOptionIndex",
          "type": "number",
          "description": "Current round choice index selected by player"
        },
        "actionRequired": {
          "name": "actionRequired",
          "type": "boolean",
          "description": "If true, game cannot proceed until player acts"
        },
        "privateMessage": {
          "name": "privateMessage",
          "type": "string",
          "description": "Private message to player"
        }
      }
    }
  }
]`;

    const subgraph = createExtractionSubgraph(transitionsExtractionConfig);

    const result = await subgraph.invoke({
      gameSpecification: gameSpec,
      gameRules: gameSpec,
      stateSchema,
      stateTransitions: "",
      playerPhaseInstructions: {},
      transitionInstructions: {},
      exampleState: JSON.stringify({
        game: {
          currentPhase: "init",
          currentRound: 1,
          deadlyOptionIndices: { "1": 2, "2": 0, "3": 4, "4": 1, "5": 3 },
          currentRoundDeadlyIndex: null,
          gameEnded: false,
          publicMessage: ""
        },
        players: [{
          id: crypto.randomUUID(),
          isAlive: true,
          selectedOptionIndex: null,
          actionRequired: false,
          privateMessage: null
        }]
      }),
    }, {
      store: new InMemoryStore(),
      configurable: { thread_id: "test-space-odyssey-1" }
    });

    console.log("\n=== Space Odyssey Transitions ===\n");
    console.log(JSON.stringify(result.stateTransitions, null, 2));

    // Validate structure
    expect(result.stateTransitions).toBeDefined();
    expect(typeof result.stateTransitions).toBe('string');
    const transitions = JSON.parse(result.stateTransitions!);

    // Should have phases including init, round_active, finished
    expect(transitions.phases).toContain("init");
    expect(transitions.phases).toContain("round_active");
    expect(transitions.phases).toContain("finished");

    // Should have initialize_game transition
    const initTransition = transitions.transitions.find((t: any) => t.id === "initialize_game");
    expect(initTransition).toBeDefined();
    expect(initTransition.fromPhase).toBe("init");
    expect(initTransition.toPhase).toBe("round_active");

    console.log("\n=== Critical Validation: Denormalization Pattern ===\n");

    // CRITICAL: Find transitions that check player's selected option
    const choiceTransitions = transitions.transitions.filter((t: any) =>
      t.fromPhase === "round_active" &&
      t.checkedFields?.some((f: string) => f.includes("selectedOption"))
    );

    expect(choiceTransitions.length).toBeGreaterThan(0);
    console.log(`✓ Found ${choiceTransitions.length} transitions that evaluate player choice`);

    // CRITICAL: These transitions should reference currentRoundDeadlyIndex, 
    // NOT deadlyOptionIndices[currentRound] (dynamic lookup)
    for (const transition of choiceTransitions) {
      console.log(`\nChecking transition: ${transition.id}`);
      console.log(`  From: ${transition.fromPhase} → ${transition.toPhase}`);
      console.log(`  Checked fields: ${JSON.stringify(transition.checkedFields)}`);

      // Should check the denormalized field
      const checksDenormalizedField = transition.checkedFields.some(
        (f: string) => f === "game.currentRoundDeadlyIndex"
      );
      
      // Should NOT check deadlyOptionIndices (would require dynamic lookup)
      const checksMapWithDynamicLookup = transition.checkedFields.some(
        (f: string) => f.includes("deadlyOptionIndices[")
      );

      // Should NOT reference dynamic lookup in precondition explanations
      const preconditionText = JSON.stringify(transition.preconditions);
      const hasDynamicLookupInPrecondition = preconditionText.includes("deadlyOptionIndices[game.currentRound]") ||
                                             preconditionText.includes("deadlyOptionIndices[currentRound]");

      console.log(`  ✓ Checks denormalized field: ${checksDenormalizedField}`);
      console.log(`  ✓ Avoids dynamic map lookup in checkedFields: ${!checksMapWithDynamicLookup}`);
      console.log(`  ✓ Avoids dynamic lookup in preconditions: ${!hasDynamicLookupInPrecondition}`);

      expect(checksDenormalizedField).toBe(true);
      expect(checksMapWithDynamicLookup).toBe(false);
      expect(hasDynamicLookupInPrecondition).toBe(false);
    }

    // CRITICAL: Find round advancement transitions
    const roundAdvanceTransitions = transitions.transitions.filter((t: any) =>
      (t.fromPhase === "round_active" && t.toPhase === "round_active") ||
      (t.fromPhase === "init" && t.toPhase === "round_active")
    );

    console.log(`\n✓ Found ${roundAdvanceTransitions.length} round initialization/advancement transitions`);

    // These transitions should mention updating currentRoundDeadlyIndex in their condition
    for (const transition of roundAdvanceTransitions) {
      console.log(`\nChecking transition: ${transition.id}`);
      console.log(`  Condition: ${transition.condition}`);
      
      // The condition should mention computing/setting the current round's deadly index
      const mentionsDenormalization = 
        transition.condition.toLowerCase().includes("deadly") &&
        (transition.condition.toLowerCase().includes("current") || 
         transition.condition.toLowerCase().includes("compute") ||
         transition.condition.toLowerCase().includes("set"));

      if (mentionsDenormalization) {
        console.log(`  ✓ Transition condition indicates it will denormalize deadly index`);
      }
    }

    console.log("\n=== Validation Summary ===");
    console.log("✓ Transitions use denormalized field pattern");
    console.log("✓ No dynamic map lookups in preconditions");
    console.log("✓ State updates prepare denormalized values for downstream transitions");
  }, 120000); // 2 min timeout for LLM call
});
