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
- Players may import a previously created character instead of starting from scratch

### Gameplay
- Characters explore dungeons and fight monsters
- Gain experience points from battles
- Level up when reaching experience thresholds
- Unlock new abilities as they progress

### Persistence
- Characters persist between game sessions
- Players can mint their character as an NFT to reuse in future matches
- Characters can be traded or gifted to other players
`;

const CHARACTER_PHASES: Record<string, string> = {
  create_character: JSON.stringify({ phase: "create_character", playerActions: ["Choose your character name and class"] }),
  explore_dungeon: JSON.stringify({ phase: "explore_dungeon", playerActions: ["Choose an action: fight, sneak, or flee"] }),
};

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

const RPS_PHASES: Record<string, string> = {
  submit_move: JSON.stringify({ phase: "submit_move", playerActions: ["Choose rock, paper, or scissors"] }),
};

describe("Extract Produced Tokens Node", () => {
  it("should create token configuration for character-based game", async () => {
    const subgraph = createExtractionSubgraph(producedTokensExtractionConfig);
    
    const inputState = {
      gameSpecification: CHARACTER_GAME_SPEC,
      stateSchema: CHARACTER_SCHEMA,
      playerPhaseInstructions: CHARACTER_PHASES,
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

    // Validate consumption configuration
    if (characterToken.consumableIn) {
      console.log(`  consumableIn: ${JSON.stringify(characterToken.consumableIn)}`);
      // Phase must be a valid player phase
      expect(Object.keys(CHARACTER_PHASES)).toContain(characterToken.consumableIn.phase);
      // actionField entries must all be in the token's fields
      expect(Array.isArray(characterToken.consumableIn.actionField)).toBe(true);
      expect(characterToken.consumableIn.actionField.length).toBeGreaterThan(0);
      for (const af of characterToken.consumableIn.actionField) {
        expect(fields).toContain(af);
      }
      console.log(`✓ consumableIn validated: phase='${characterToken.consumableIn.phase}', actionField=${JSON.stringify(characterToken.consumableIn.actionField)}`);
    }

    // actionId is optional but if present should be a string
    if (characterToken.actionId) {
      expect(typeof characterToken.actionId).toBe('string');
      console.log(`✓ actionId: '${characterToken.actionId}'`);
    }
  }, 60000);

  it("should return empty configuration for ephemeral match game", async () => {
    const subgraph = createExtractionSubgraph(producedTokensExtractionConfig);
    
    const inputState = {
      gameSpecification: RPS_SPEC,
      stateSchema: RPS_SCHEMA,
      playerPhaseInstructions: RPS_PHASES,
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
      playerPhaseInstructions: CHARACTER_PHASES,
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

  it("should produce achievement token without consumableIn", async () => {
    const subgraph = createExtractionSubgraph(producedTokensExtractionConfig);

    const achievementSpec = `
# Space Racing League

## Overview
Players compete in orbital races around different planets.

## Game Rules

### Gameplay
- Each round, players choose a racing line: inside, middle, or outside
- Fuel management affects speed — players must balance risk vs conservation
- First player to complete 5 laps wins the race

### Trophies
- Race winners can mint a trophy NFT commemorating their victory
- Trophies record the track name and winning time
- These are display-only collectibles and have no gameplay effect
`;

    const achievementSchema = JSON.stringify([
      { name: "trackName", path: "game", type: "string", purpose: "Name of the racing track" },
      { name: "winningTime", path: "game", type: "string", purpose: "Best finishing time" },
      { name: "currentLap", path: "game", type: "number", purpose: "Current lap number" },
      { name: "racingLine", path: "player", type: "string", purpose: "Player's chosen racing line" },
      { name: "fuel", path: "player", type: "number", purpose: "Remaining fuel" },
      { name: "ready", path: "player", type: "boolean", purpose: "Player ready status" },
    ]);

    const achievementPhases: Record<string, string> = {
      choose_racing_line: JSON.stringify({ phase: "choose_racing_line", playerActions: ["Choose: inside, middle, or outside"] }),
    };

    const inputState = {
      gameSpecification: achievementSpec,
      stateSchema: achievementSchema,
      playerPhaseInstructions: achievementPhases,
    };

    console.log("\nExtracting token config for achievement game...");
    const result = await subgraph.invoke(
      inputState,
      createArtifactCreationGraphConfig("test-token-achievement", new InMemoryStore())
    );

    expect(result.producedTokensConfiguration).toBeDefined();
    const tokenConfig = JSON.parse(result.producedTokensConfiguration!);

    console.log("\n=== Token Configuration ===");
    console.log(JSON.stringify(tokenConfig, null, 2));

    expect(tokenConfig.tokens).toBeDefined();
    expect(Array.isArray(tokenConfig.tokens)).toBe(true);
    expect(tokenConfig.tokens.length).toBeGreaterThan(0);

    const achievementToken = tokenConfig.tokens[0];
    expect(achievementToken.tokenType).toBeDefined();
    expect(achievementToken.tokenSource).toBe("game");
    expect(Array.isArray(achievementToken.fields)).toBe(true);
    expect(achievementToken.fields.length).toBeGreaterThan(0);

    // Pure trophy — should NOT have consumableIn or actionId
    expect(achievementToken.consumableIn).toBeUndefined();
    expect(achievementToken.actionId).toBeUndefined();

    console.log(`✓ Achievement token has ${achievementToken.fields.length} fields: ${achievementToken.fields.join(', ')}`);
    console.log("✓ No consumableIn — pure collectible trophy");
    console.log("✓ No actionId — not usable as game input");
  }, 60000);
});
