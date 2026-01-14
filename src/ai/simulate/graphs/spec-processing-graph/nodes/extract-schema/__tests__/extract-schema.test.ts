/**
 * Test for extract-schema node
 * 
 * Validates that the node can:
 * 1. Extract game rules from specification
 * 2. Generate valid state schema with required runtime fields
 * 3. Create example state matching the schema
 */

import { describe, expect, it } from "@jest/globals";
import { extractSchema, validatePlannerFieldsInSchema } from "../index.js";
import { setupSpecProcessingModel } from "#chaincraft/ai/model-config.js";
import { buildStateSchema, SchemaField } from "#chaincraft/ai/simulate/schemaBuilder.js";
import { deserializeSchema } from "#chaincraft/ai/simulate/schema.js";

describe("validatePlannerFieldsInSchema", () => {
  const mockSchema = {
    type: "object",
    properties: {
      game: {
        type: "object",
        properties: {
          turnNumber: { type: "number" },
          score: { type: "number" },
          currentPhase: { type: "string" }
        }
      },
      players: {
        type: "object",
        additionalProperties: {
          type: "object",
          properties: {
            selectedChoice: { type: "number" },
            ready: { type: "boolean" }
          }
        }
      }
    }
  };

  it("should validate game fields with 'game.' prefix when path is 'game'", () => {
    const plannerFields = [
      { name: "game.turnNumber", path: "game" },
      { name: "game.score", path: "game" }
    ];

    const result = validatePlannerFieldsInSchema(plannerFields, mockSchema);

    expect(result.valid).toBe(true);
    expect(result.missingFields).toEqual([]);
  });

  it("should validate player fields with 'players.<id>.' prefix when path is 'player'", () => {
    const plannerFields = [
      { name: "players.<id>.selectedChoice", path: "player" },
      { name: "players.<id>.ready", path: "player" }
    ];

    const result = validatePlannerFieldsInSchema(plannerFields, mockSchema);

    expect(result.valid).toBe(true);
    expect(result.missingFields).toEqual([]);
  });

  it("should validate bare field names without prefix", () => {
    const plannerFields = [
      { name: "turnNumber", path: "game" },
      { name: "selectedChoice", path: "player" }
    ];

    const result = validatePlannerFieldsInSchema(plannerFields, mockSchema);

    expect(result.valid).toBe(true);
    expect(result.missingFields).toEqual([]);
  });

  it("should fail validation when game field has wrong prefix (player. instead of game.)", () => {
    const plannerFields = [
      { name: "player.turnNumber", path: "game" }
    ];

    const result = validatePlannerFieldsInSchema(plannerFields, mockSchema);

    expect(result.valid).toBe(false);
    expect(result.missingFields).toEqual(["player.turnNumber"]);
  });

  it("should fail validation when player field has wrong prefix (game. instead of players.)", () => {
    const plannerFields = [
      { name: "game.selectedChoice", path: "player" }
    ];

    const result = validatePlannerFieldsInSchema(plannerFields, mockSchema);

    expect(result.valid).toBe(false);
    expect(result.missingFields).toEqual(["game.selectedChoice"]);
  });

  it("should fail validation for missing fields", () => {
    const plannerFields = [
      { name: "game.nonExistentField", path: "game" },
      { name: "players.<id>.missingField", path: "player" }
    ];

    const result = validatePlannerFieldsInSchema(plannerFields, mockSchema);

    expect(result.valid).toBe(false);
    expect(result.missingFields).toContain("game.nonExistentField");
    expect(result.missingFields).toContain("players.<id>.missingField");
    expect(result.missingFields).toHaveLength(2);
  });

  it("should pass validation for mixed valid fields with and without prefixes", () => {
    const plannerFields = [
      { name: "game.turnNumber", path: "game" },
      { name: "score", path: "game" },
      { name: "players.<id>.selectedChoice", path: "player" },
      { name: "ready", path: "player" }
    ];

    const result = validatePlannerFieldsInSchema(plannerFields, mockSchema);

    expect(result.valid).toBe(true);
    expect(result.missingFields).toEqual([]);
  });
});

const RPS_SPEC = `
# 3-Player Rock-Paper-Scissors Tournament

## Overview
A tournament version of Rock-Paper-Scissors for exactly 3 players, played over 3 rounds.

## Game Rules

### Setup
- Three players join the game
- Players are assigned IDs: player1, player2, player3

### Gameplay
1. Each round, all 3 players simultaneously submit a move: Rock, Paper, or Scissors
2. Valid moves: "rock", "paper", "scissors" (case-insensitive)
3. Once all players have submitted, the round is evaluated

### Scoring System
Each player competes against the other two players in head-to-head matchups:
- Win: +1 point (Rock beats Scissors, Scissors beats Paper, Paper beats Rock)
- Tie: 0 points (same move)
- Loss: -1 point

Per round, each player:
- Plays 2 matches (one against each opponent)
- Can score between -2 and +2 points

### Victory Conditions
- Game ends after 3 rounds
- Player with highest cumulative score wins
- Ties are possible

### Game Phases
1. **Setup**: Waiting for all 3 players to join
2. **Playing**: Active rounds where players submit moves
3. **Finished**: Game concluded, winner determined
`;

describe("Extract Schema Node", () => {
  it("should extract game rules, schema, and example state from specification", async () => {
    // Setup - Uses Sonnet via CHAINCRAFT_SPEC_PROCESSING_MODEL env var
    const model = await setupSpecProcessingModel();
    const schemaNode = extractSchema(model);
    
    const state = {
      gameSpecification: RPS_SPEC,
      gameRules: "",
      stateSchema: "",
      stateTransitions: "",
      playerPhaseInstructions: {},
      transitionInstructions: {},
      exampleState: "",
    };

    // Execute
    console.log("Extracting schema from RPS specification...");
    const result = await schemaNode({
      ...state,
    });

    // Validate game rules
    expect(result.gameRules).toBeDefined();
    expect(result.gameRules?.length).toBeGreaterThan(100);
    expect(result.gameRules).toContain("Rock");
    expect(result.gameRules).toContain("Paper");
    expect(result.gameRules).toContain("Scissors");
    console.log("✓ Game rules extracted");

    // Validate state schema (now JSON Schema format)
    expect(result.stateSchema).toBeDefined();
    const schema = JSON.parse(result.stateSchema!);
    expect(schema.type).toBe("object");
    expect(schema.properties).toBeDefined();
    expect(schema.properties.game).toBeDefined();
    expect(schema.properties.players).toBeDefined();
    console.log("✓ Schema has game and players fields");
    
    // Debug: Show the actual schema structure
    console.log("\n=== Schema Structure (JSON Schema) ===");
    console.log("Game field type:", schema.properties.game.type);
    console.log("Game properties:", Object.keys(schema.properties.game.properties || {}));
    console.log("Players field type:", schema.properties.players.type);
    console.log("Players additionalProperties:", schema.properties.players.additionalProperties ? "defined" : "undefined");
    console.log("Player properties:", Object.keys(schema.properties.players.additionalProperties?.properties || {}));

    // Print field descriptions to help verify .describe() usage
    console.log('\n=== Generated Schema Field Descriptions ===');
    console.log(`- Field: game (type=${schema.properties.game.type})`);
    const gameProps = schema.properties.game.properties || {};
    for (const [pname, pdef] of Object.entries(gameProps)) {
      const desc = (pdef as any).description || null;
      const ptype = (pdef as any).type || 'unknown';
      const preq = schema.properties.game.required?.includes(pname) || false;
      console.log(`  - ${pname}: type=${ptype} required=${preq} description=${desc}`);
    }
    
    console.log(`- Field: players (type=${schema.properties.players.type})`);
    const playerProps = schema.properties.players.additionalProperties?.properties || {};
    for (const [pname, pdef] of Object.entries(playerProps)) {
      const desc = (pdef as any).description || null;
      const ptype = (pdef as any).type || 'unknown';
      const preq = schema.properties.players.additionalProperties?.required?.includes(pname) || false;
      console.log(`  - ${pname}: type=${ptype} required=${preq} description=${desc}`);
    }

    // Check required runtime fields in game
    const gameProperties = schema.properties.game.properties || {};
    expect(gameProperties.gameEnded).toBeDefined();
    expect(gameProperties.publicMessage).toBeDefined();
    console.log("✓ Game has required runtime fields");

    // Check required runtime fields in players
    const playerProperties = schema.properties.players.additionalProperties?.properties || {};
    expect(playerProperties.illegalActionCount).toBeDefined();
    expect(playerProperties.privateMessage).toBeDefined();
    // actionsAllowed should be defined in schema (optional field)
    expect(playerProperties.actionsAllowed).toBeDefined();
    expect(playerProperties.actionRequired).toBeDefined();
    console.log("✓ Players have required runtime fields");

    // Validate example state
    expect(result.exampleState).toBeDefined();
    const exampleState = JSON.parse(result.exampleState!);
    expect(exampleState.game).toBeDefined();
    expect(exampleState.players).toBeDefined();
    expect(exampleState.game.gameEnded).toBe(false);
    expect(exampleState.game.publicMessage).toBeDefined();
    console.log("✓ Example state is valid");
    
    // Debug: Show actual state structure
    console.log("\n=== Example State Structure ===");
    console.log("Game keys:", Object.keys(exampleState.game));
    console.log("Players keys:", Object.keys(exampleState.players));
    if (Object.keys(exampleState.players).length > 0) {
      const firstPlayerId = Object.keys(exampleState.players)[0];
      console.log(`Sample player (${firstPlayerId}) keys:`, Object.keys(exampleState.players[firstPlayerId]));
    }

    // Validate schema can be used to build Zod schema
    const zodSchema = deserializeSchema(result.stateSchema!);
    expect(zodSchema).toBeDefined();
    console.log("✓ Schema can be built into Zod schema");

    // Note: We don't strictly validate example state against schema here because
    // the LLM may structure the example slightly differently than the schema builder expects.
    // The real validation happens when games are initialized and run.
    // This test focuses on verifying the schema has all required runtime fields.

    // Validate the the generated schema extends the base schema (no missing fields)
    const baseSchema = buildStateSchema([]);

    // Helper to safely extract property keys from a Zod object shape
    const extractZodKeys = (obj: any) => {
      try {
        if (!obj) return [];
        // obj is a Zod schema with .shape
        return Object.keys(obj.shape || {});
      } catch (e) {
        return [];
      }
    };

    // Extract base schema keys for game and players
    const baseGameKeys = extractZodKeys((baseSchema as any).shape.game);
    const basePlayersKeys = extractZodKeys((baseSchema as any).shape.players?.value || (baseSchema as any).shape.players);

    // Extract generated schema keys from the deserialized zod schema
    const genGameKeys = extractZodKeys((zodSchema as any).shape.game);
    const genPlayersKeys = extractZodKeys((zodSchema as any).shape.players?.value || (zodSchema as any).shape.players);

    const missingGameKeys = baseGameKeys.filter(k => !genGameKeys.includes(k));
    const missingPlayerKeys = basePlayersKeys.filter(k => !genPlayersKeys.includes(k));

    if (missingGameKeys.length > 0 || missingPlayerKeys.length > 0) {
      console.error('Missing required base schema fields:', { missingGameKeys, missingPlayerKeys });
    }

    expect(missingGameKeys).toEqual([]);
    expect(missingPlayerKeys).toEqual([]);
    console.log("✓ Generated schema extends the base schema (no missing fields)");

    console.log("\n=== Extract Schema Test Complete ===");
    console.log(`Game Rules Length: ${result.gameRules?.length} chars`);
    console.log(`Schema Type: JSON Schema`);
    console.log(`Game Properties: ${Object.keys(gameProperties).length}`);
    console.log(`Player Properties: ${Object.keys(playerProperties).length}`);
  }, 120000); // 60s timeout for LLM calls

  it("should add storage field for dice roll randomness", async () => {
    console.log("\n=== Testing RNG Storage Field Detection ===");
    
    const DICE_ROLL_SPEC = `
# Monster Battle Game

## Overview
A simple turn-based game where players face a monster.

## Game Rules

### Setup
- 2-4 players join the game
- Each player starts with 10 health points
- Monster has 20 health points

### Gameplay
1. Each turn, a d20 dice is rolled to determine if the monster attacks
2. If the roll is 15 or higher, the monster attacks a random player
3. Players then take turns attacking the monster
4. Each player attack does 2 damage to the monster

### Victory Conditions
- Players win if monster health reaches 0
- Players lose if all players reach 0 health
`;

    const model = await setupSpecProcessingModel();
    const schemaNode = extractSchema(model);
    
    const state = {
      gameSpecification: DICE_ROLL_SPEC,
      gameRules: "",
      stateSchema: "",
    };

    console.log("Extracting schema with dice roll randomness...");
    const result = await schemaNode(state);

    expect(result.stateSchema).toBeTruthy();
    
    // Parse the generated schema
    const parsedSchema = JSON.parse(result.stateSchema);
    const gameProperties = parsedSchema.properties.game.properties;
    
    console.log("\nGame-level fields:", Object.keys(gameProperties));
    
    // Check if AI added a field to store dice roll result
    const hasDiceRollField = Object.keys(gameProperties).some(key => 
      key.toLowerCase().includes('roll') || 
      key.toLowerCase().includes('dice') ||
      key.toLowerCase().includes('attack')
    );
    
    if (hasDiceRollField) {
      const diceFields = Object.keys(gameProperties).filter(key => 
        key.toLowerCase().includes('roll') || 
        key.toLowerCase().includes('dice') ||
        key.toLowerCase().includes('attack')
      );
      console.log("✓ AI added RNG storage field(s):", diceFields);
    } else {
      console.log("✗ AI did NOT add any dice roll storage field");
    }
    
    expect(hasDiceRollField).toBe(true);
  }, 120000);
});
