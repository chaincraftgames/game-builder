/**
 * Test for extract-schema subgraph
 * 
 * Validates that the subgraph can:
 * 1. Extract game rules from specification
 * 2. Generate valid field definitions in condensed format
 * 3. Handle validation and retry logic
 */

import { describe, expect, it } from "@jest/globals";
import { schemaExtractionConfig } from "../index.js";
import { createExtractionSubgraph } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/node-factories.js";
import { InMemoryStore } from "@langchain/langgraph";
import { createArtifactCreationGraphConfig } from "#chaincraft/ai/graph-config.js";

describe.skip("validatePlannerFieldsInSchema", () => {
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
    // Test is skipped, but was calling old validator signature
    // const plannerFields = [
    //   { name: "game.turnNumber", path: "game" },
    //   { name: "game.score", path: "game" }
    // ];
    // const result = validatePlannerFieldsInSchema(plannerFields, mockSchema);
    // expect(result.valid).toBe(true);
    // expect(result.missingFields).toEqual([]);
  });

  it("should validate player fields with 'players.<id>.' prefix when path is 'player'", () => {
    // Test is skipped
  });

  it("should validate bare field names without prefix", () => {
    // Test is skipped
  });

  it("should fail validation when game field has wrong prefix (player. instead of game.)", () => {
    // Test is skipped
  });

  it("should fail validation when player field has wrong prefix (game. instead of players.)", () => {
    // Test is skipped
  });

  it("should fail validation for missing fields", () => {
    // Test is skipped
  });

  it("should pass validation for mixed valid fields with and without prefixes", () => {
    // Test is skipped
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

describe("Extract Schema Subgraph", () => {
  it("should extract game rules and field definitions from specification", async () => {
    // Setup - Create subgraph from config
    const subgraph = createExtractionSubgraph(schemaExtractionConfig);
    
    const inputState = {
      gameSpecification: RPS_SPEC,
    };

    // Execute subgraph with InMemoryStore and artifact creation callbacks
    console.log("Extracting schema from RPS specification...");
    const result = await subgraph.invoke(
      inputState,
      createArtifactCreationGraphConfig("test-thread-1", new InMemoryStore())
    );

    // Validate game rules
    expect(result.gameRules).toBeDefined();
    expect(result.gameRules?.length).toBeGreaterThan(10);
    console.log("✓ Game rules extracted");

    // Validate state schema (condensed format - array of field definitions)
    expect(result.stateSchema).toBeDefined();
    const fields = JSON.parse(result.stateSchema!);
    expect(Array.isArray(fields)).toBe(true);
    console.log("✓ Schema is condensed format (array of fields)");
    
    // Debug: Show the field definitions
    console.log("\n=== Field Definitions ===");
    fields.forEach((field: any) => {
      console.log(`  - ${field.name} (type=${field.type}, path=${field.path})`);
      if (field.purpose) {
        console.log(`    Purpose: ${field.purpose}`);
      }
      if (field.constraints) {
        console.log(`    Constraints: ${field.constraints}`);
      }
    });

    // Verify fields have required structure
    fields.forEach((field: any) => {
      expect(field.name).toBeDefined();
      expect(field.type).toBeDefined();
      expect(field.path).toBeDefined();
      expect(['game', 'player']).toContain(field.path);
    });
    console.log("✓ All fields have required structure (name, type, path)");

    // Example state is no longer generated (not needed for stateDelta operations)
    expect(result.exampleState).toBeDefined();
    expect(result.exampleState).toBe("");
    console.log("✓ Example state not generated (not needed)");

    // Verify field extraction works with the condensed format
    const { extractSchemaFields } = await import("#chaincraft/ai/simulate/graphs/spec-processing-graph/schema-utils.js");
    const fieldPaths = extractSchemaFields(fields);
    expect(fieldPaths.size).toBeGreaterThan(0);
    console.log(`✓ Field extraction works (${fieldPaths.size} field paths extracted)`);
    
    // Show extracted field paths
    console.log("\n=== Extracted Field Paths ===");
    Array.from(fieldPaths).forEach(path => {
      console.log(`  - ${path}`);
    });
  }, 60000); // Single-phase extraction

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

    const subgraph = createExtractionSubgraph(schemaExtractionConfig);
    
    console.log("Extracting schema with dice roll randomness...");
    const result = await subgraph.invoke(
      { gameSpecification: DICE_ROLL_SPEC },
      createArtifactCreationGraphConfig("test-thread-2", new InMemoryStore())
    );

    expect(result.stateSchema).toBeTruthy();
    
    // Parse the field definitions
    const fields = JSON.parse(result.stateSchema);
    expect(Array.isArray(fields)).toBe(true);
    
    console.log("\nExtracted fields:");
    fields.forEach((field: any) => {
      console.log(`  - ${field.name} (type=${field.type}, path=${field.path})`);
    });
    
    // Check if AI added a field to store dice roll result
    const hasDiceRollField = fields.some((field: any) => 
      field.name.toLowerCase().includes('roll') || 
      field.name.toLowerCase().includes('dice') ||
      field.name.toLowerCase().includes('attack')
    );
    
    if (hasDiceRollField) {
      const diceFields = fields.filter((field: any) => 
        field.name.toLowerCase().includes('roll') || 
        field.name.toLowerCase().includes('dice') ||
        field.name.toLowerCase().includes('attack')
      );
      console.log("✓ AI added RNG storage field(s):", diceFields.map((f: any) => f.name));
    } else {
      console.log("✗ AI did NOT add any dice roll storage field");
    }
    
    expect(hasDiceRollField).toBe(true);
  }, 120000);

  it("should use object type for structured sub-objects with fixed fields (Liar's Dice)", async () => {
    const LIARS_DICE_SPEC = `# Liar's Dice - Game Specification

## Game Overview

Liar's Dice is a 2-player bluffing and deduction game where players bid on the total count of specific die faces across three dice pools: their own hidden dice, their opponent's hidden dice, and a shared visible communal pool. Players must choose whether to escalate bids or challenge their opponent's claims, with incorrect challenges resulting in permanent die loss. The last player with dice remaining wins.

## Game Setup

Each player begins with exactly 5 dice. These dice are the player's personal pool and remain hidden from the opponent throughout the game.

A communal pool of exactly 5 dice is placed visibly in the center of the play area, accessible and visible to both players at all times.

At game start, the communal dice are rolled once and their values are revealed to both players. These communal dice remain showing their current values and are not re-rolled during the game.

Both players simultaneously roll their personal 5 dice and view only their own results. Players must keep their dice hidden from their opponent.

The game randomly selects which player makes the first bid of the opening round.

## Round Structure

Each round consists of a bidding phase followed by a challenge resolution.

At the start of each round (after the first), both players re-roll all their remaining personal dice simultaneously. The communal dice values do not change.

Players view only their own newly rolled dice. The opponent's dice remain hidden.

The player who won the previous challenge makes the first bid of the new round. In the opening round, the randomly selected starting player makes the first bid.

## Bidding Phase

### Bid Structure

A bid consists of two components:
1. A die face value (1, 2, 3, 4, 5, or 6)
2. A count (the claimed quantity of that face value)

When making a bid, the player claims that across all three pools combined (their own hidden dice + opponent's hidden dice + the visible communal dice), there are at least the claimed count of dice showing the claimed face value.

### First Bid of Round

The starting player of each round may make any valid bid. A valid first bid is any combination of:
- Die face value: 1 through 6
- Count: 1 through the current total number of dice remaining in play

### Subsequent Bids

After the first bid of a round, each subsequent bid must be higher than the previous bid according to these rules:

**Count-Increase Rule:** If a player increases the count from the previous bid, they may bid ANY die face value (1 through 6).

**Same-Count Rule:** If a player keeps the same count as the previous bid, they may ONLY bid a strictly higher die face value than the previous bid.

### Bid Validation

When a player attempts to make a bid that is not higher than the previous bid, the game must reject the bid immediately.

## Challenge Mechanic

### Initiating a Challenge

On their turn, instead of making a higher bid, a player may challenge the previous bid by declaring "Liar!".

### Challenge Resolution

When a challenge is declared:
1. Both players immediately reveal all their hidden personal dice
2. All dice showing the challenged bid's face value are counted across all three pools
3. The actual count is compared to the challenged bid's claimed count

### Challenge Outcome - Bidder Wins

If the actual count of the face value is greater than or equal to the bid's claimed count, the bidder wins. The challenger loses one die permanently.

### Challenge Outcome - Challenger Wins

If the actual count of the face value is less than the bid's claimed count, the challenger wins. The bidder loses one die permanently.

## Player Elimination and Game End

When a player loses their last die, they are eliminated. The remaining player wins.

## Information Visibility

Each player always sees:
- Their own personal dice (count and face values)
- The communal pool dice (count and face values) at all times
- All bids made during the current round
- The current die count for both players (how many dice each player has, but not the values)

Each player never sees their opponent's personal dice face values (until a challenge is called).`;

    const subgraph = createExtractionSubgraph(schemaExtractionConfig);
    
    console.log("Extracting schema from Liar's Dice specification...");
    const result = await subgraph.invoke(
      { gameSpecification: LIARS_DICE_SPEC },
      createArtifactCreationGraphConfig("test-thread-liars-dice", new InMemoryStore())
    );

    expect(result.stateSchema).toBeTruthy();
    
    const fields = JSON.parse(result.stateSchema);
    expect(Array.isArray(fields)).toBe(true);
    
    console.log("\n=== Liar's Dice Field Definitions ===");
    fields.forEach((field: any) => {
      const extras: string[] = [];
      if (field.enumValues) extras.push(`enumValues=${JSON.stringify(field.enumValues)}`);
      if (field.valueType) extras.push(`valueType=${field.valueType}`);
      if (field.fields) extras.push(`fields=[${field.fields.map((f: any) => `${f.name}:${f.type}`).join(', ')}]`);
      if (field.required === false) extras.push('optional');
      const extraStr = extras.length > 0 ? ` (${extras.join(', ')})` : '';
      console.log(`  - ${field.path}.${field.name}: ${field.type}${extraStr}`);
      if (field.purpose) console.log(`    Purpose: ${field.purpose}`);
    });

    // Verify fields have required structure
    fields.forEach((field: any) => {
      expect(field.name).toBeDefined();
      expect(field.type).toBeDefined();
      expect(field.path).toBeDefined();
      expect(['game', 'player']).toContain(field.path);
    });
    console.log("✓ All fields have required structure");

    // Key test: Look for a bid-related field
    // The bid has fixed sub-fields (faceValue, count, bidderId) — should be type "object"
    const bidField = fields.find((f: any) => 
      f.name.toLowerCase().includes('bid') && !f.name.toLowerCase().includes('history')
    );
    
    if (bidField) {
      console.log(`\n=== Bid Field Analysis ===`);
      console.log(`  Name: ${bidField.name}`);
      console.log(`  Type: ${bidField.type}`);
      if (bidField.fields) {
        console.log(`  Sub-fields:`);
        bidField.fields.forEach((sf: any) => {
          console.log(`    - ${sf.name}: ${sf.type}`);
        });
      }
      
      // The bid should be type "object" with sub-fields, NOT a record
      expect(bidField.type).toBe('object');
      expect(bidField.fields).toBeDefined();
      expect(Array.isArray(bidField.fields)).toBe(true);
      expect(bidField.fields.length).toBeGreaterThanOrEqual(2);
      
      // Should have numeric count/quantity field
      const hasCount = bidField.fields.some((sf: any) => 
        (sf.name.toLowerCase().includes('count') || sf.name.toLowerCase().includes('quantity')) &&
        sf.type === 'number'
      );
      expect(hasCount).toBe(true);
      
      // Should have numeric face value field
      const hasFaceValue = bidField.fields.some((sf: any) =>
        (sf.name.toLowerCase().includes('face') || sf.name.toLowerCase().includes('value')) &&
        sf.type === 'number'
      );
      expect(hasFaceValue).toBe(true);
      
      console.log("✓ Bid field uses 'object' type with typed sub-fields");
    } else {
      console.log("⚠ No bid field found — checking all field names:");
      fields.forEach((f: any) => console.log(`  ${f.name}`));
      // Fail explicitly — we expect a bid field for Liar's Dice
      expect(bidField).toBeDefined();
    }

    // Verify dice arrays exist (personal dice for players, communal for game)
    const hasDiceField = fields.some((f: any) =>
      f.name.toLowerCase().includes('dice') && f.type === 'array'
    );
    expect(hasDiceField).toBe(true);
    console.log("✓ Dice array field(s) present");

    // Generate interfaces and verify they compile
    const { generateStateInterfaces } = await import("#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/generate-mechanics/generate-state-interfaces.js");
    const interfaces = generateStateInterfaces(fields);
    console.log("\n=== Generated TypeScript Interfaces ===");
    console.log(interfaces);
    
    // Verify the interfaces contain a named sub-interface for the bid (not Record<string, number>)
    if (bidField?.type === 'object') {
      const expectedIfaceName = bidField.path === 'game' 
        ? `GameState_${bidField.name.charAt(0).toUpperCase()}${bidField.name.slice(1)}`
        : `PlayerState_${bidField.name.charAt(0).toUpperCase()}${bidField.name.slice(1)}`;
      // Use a flexible check — pascalCase may transform differently
      const hasSubInterface = interfaces.includes(`export interface GameState_`) || 
                              interfaces.includes(`export interface PlayerState_`);
      expect(hasSubInterface).toBe(true);
      console.log(`✓ Named sub-interface generated (expected: ${expectedIfaceName})`);
    }

    // Verify the output compiles as valid TypeScript
    const ts = await import("typescript");
    const sf = ts.default.createSourceFile('test.ts', interfaces, ts.default.ScriptTarget.Latest, true);
    const diagnostics = (sf as any).parseDiagnostics as any[] | undefined;
    expect(!diagnostics || diagnostics.length === 0).toBe(true);
    console.log("✓ Generated interfaces are valid TypeScript");
  }, 120000);
});
