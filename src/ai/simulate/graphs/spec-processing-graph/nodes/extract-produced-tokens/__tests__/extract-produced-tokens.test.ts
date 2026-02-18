/**
 * Test for extract-produced-tokens node
 * 
 * Validates that the node can:
 * 1. Detect when tokens are appropriate
 * 2. Extract valid produced token configurations
 * 3. Validate fields exist in state schema
 * 4. Handle games without tokens
 */

import { describe, expect, it } from "@jest/globals";
import { producedTokensExtractionConfig } from "../index.js";
import { createExtractionSubgraph } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/node-factories.js";
import { InMemoryStore } from "@langchain/langgraph";
import { createArtifactCreationGraphConfig } from "#chaincraft/ai/graph-config.js";
import { TokenSource } from "#chaincraft/ai/simulate/schema.js";

const CHARACTER_GAME_SPEC = `
# Fantasy Adventure RPG

## Overview
A persistent character progression game where players create and develop unique characters.

## Game Rules

### Character Creation
- Players create a character with:
  - Name (player chosen)
  - Class (warrior, mage, rogue)
  - Starting level: 1
  - Starting health: 100

### Gameplay
- Characters explore dungeons and fight monsters
- Gain experience points from battles
- Level up when reaching experience thresholds
- Unlock new abilities as they progress

### Persistence
- Characters persist between game sessions
- Players can import/export their characters
- Characters can be traded or gifted to other players
`;

const CHARACTER_SCHEMA = JSON.stringify([
  { name: "currentDungeon", path: "game", type: "string", purpose: "Current dungeon level" },
  { name: "monstersDefeated", path: "game", type: "number", purpose: "Total monsters defeated" },
  { name: "name", path: "player", type: "string", purpose: "Character name" },
  { name: "class", path: "player", type: "string", purpose: "Character class" },
  { name: "level", path: "player", type: "number", purpose: "Character level" },
  { name: "experience", path: "player", type: "number", purpose: "Experience points" },
  { name: "currentHealth", path: "player", type: "number", purpose: "Current health" },
  { name: "ready", path: "player", type: "boolean", purpose: "Player ready status" },
]);

const RPS_SPEC = `
# Rock-Paper-Scissors Tournament

## Overview
A quick tournament version of Rock-Paper-Scissors for 3 players.

## Game Rules

### Setup
- Three players join the game
- Game lasts 3 rounds

### Gameplay
1. Each round, all players simultaneously submit a move: Rock, Paper, or Scissors
2. Once all players submit, the round is evaluated
3. Score is calculated based on wins/losses

### Victory
- Player with highest score after 3 rounds wins
`;

const RPS_SCHEMA = JSON.stringify([
  { name: "roundNumber", path: "game", type: "number", purpose: "Current round" },
  { name: "totalRounds", path: "game", type: "number", purpose: "Total rounds" },
  { name: "currentMove", path: "player", type: "string", purpose: "Player's move this round" },
  { name: "score", path: "player", type: "number", purpose: "Player's cumulative score" },
  { name: "ready", path: "player", type: "boolean", purpose: "Player ready status" },
]);

describe("Extract Produced Tokens Node", () => {
  it("should create token configuration for character-based game", async () => {
    const subgraph = createExtractionSubgraph(producedTokensExtractionConfig);
    
    const inputState = {
      gameSpecification: CHARACTER_GAME_SPEC,
      stateSchema: CHARACTER_SCHEMA,
    };

    console.log("Extracting token config from character game...");
    const result = await subgraph.invoke(
      inputState,
      createArtifactCreationGraphConfig("test-token-char", new InMemoryStore())
    );

    // Validate token configuration exists
    expect(result.producedTokensConfiguration).toBeDefined();
    const tokenConfig = JSON.parse(result.producedTokensConfiguration!);
    
    console.log("\n=== Token Configuration ===");
    console.log(JSON.stringify(tokenConfig, null, 2));

    // Should have tokens object with array
    expect(tokenConfig.tokens).toBeDefined();
    expect(Array.isArray(tokenConfig.tokens)).toBe(true);
    expect(tokenConfig.tokens.length).toBeGreaterThan(0);
    
    // Get the first token (should be character-related)
    const characterToken = tokenConfig.tokens[0];
    
    // Validate token structure
    expect(characterToken).toBeDefined();
    expect(characterToken.tokenType).toBeDefined();
    expect(characterToken.description).toBeDefined();
    expect(characterToken.tokenSource).toBe(TokenSource.Player);
    expect(Array.isArray(characterToken.fields)).toBe(true);
    expect(characterToken.fields.length).toBeGreaterThan(0);
    
    // Should include character attributes but not ephemeral state
    const fields = characterToken.fields;
    
    // Should include character identity/progression
    const hasCharacterFields = fields.some((f: string) => 
      ['name', 'class', 'level'].includes(f)
    );
    expect(hasCharacterFields).toBe(true);
    
    // Should NOT include ephemeral state
    expect(fields).not.toContain('ready');
    expect(fields).not.toContain('currentHealth'); // Current health is ephemeral
    
    console.log(`✓ Character token has ${fields.length} fields: ${fields.join(', ')}`);
  }, 60000);

  it("should return empty configuration for ephemeral match game", async () => {
    const subgraph = createExtractionSubgraph(producedTokensExtractionConfig);
    
    const inputState = {
      gameSpecification: RPS_SPEC,
      stateSchema: RPS_SCHEMA,
    };

    console.log("\nExtracting token config from RPS game...");
    const result = await subgraph.invoke(
      inputState,
      createArtifactCreationGraphConfig("test-token-rps", new InMemoryStore())
    );

    // Validate token configuration exists but is empty
    expect(result.producedTokensConfiguration).toBeDefined();
    const tokenConfig = JSON.parse(result.producedTokensConfiguration!);
    
    console.log("\n=== Token Configuration ===");
    console.log(JSON.stringify(tokenConfig, null, 2));

    // Should have tokens object with empty array - no persistent assets in RPS
    expect(tokenConfig.tokens).toBeDefined();
    expect(Array.isArray(tokenConfig.tokens)).toBe(true);
    expect(tokenConfig.tokens.length).toBe(0);
    
    console.log("✓ No tokens generated for ephemeral game");
  }, 60000);

  it("should validate fields exist in schema", async () => {
    const subgraph = createExtractionSubgraph(producedTokensExtractionConfig);
    
    // Create schema with only a few fields
    const limitedSchema = JSON.stringify([
      { name: "name", path: "player", type: "string", purpose: "Player name" },
      { name: "score", path: "player", type: "number", purpose: "Player score" },
    ]);
    
    const inputState = {
      gameSpecification: CHARACTER_GAME_SPEC,
      stateSchema: limitedSchema,
    };

    console.log("\nExtracting token config with limited schema...");
    const result = await subgraph.invoke(
      inputState,
      createArtifactCreationGraphConfig("test-token-validation", new InMemoryStore())
    );

    // Should still succeed (might return empty or only use available fields)
    expect(result.producedTokensConfiguration).toBeDefined();
    const tokenConfig = JSON.parse(result.producedTokensConfiguration!);
    
    console.log("\n=== Token Configuration ===");
    console.log(JSON.stringify(tokenConfig, null, 2));

    // If tokens are created, all fields should exist in the limited schema
    expect(tokenConfig.tokens).toBeDefined();
    expect(Array.isArray(tokenConfig.tokens)).toBe(true);
    for (const config of tokenConfig.tokens) {
      const { tokenType, fields } = config;
      if (Array.isArray(fields)) {
        fields.forEach((field: string) => {
          const fieldExists = ['name', 'score'].includes(field);
          expect(fieldExists).toBe(true);
          console.log(`✓ Token '${tokenType}' field '${field}' validated in schema`);
        });
      }
    }
  }, 60000);
});
