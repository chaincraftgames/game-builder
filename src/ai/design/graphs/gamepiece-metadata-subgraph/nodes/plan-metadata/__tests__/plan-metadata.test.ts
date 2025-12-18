/**
 * Plan Metadata Node Tests
 * 
 * Tests the metadata planning functionality that analyzes conversation
 * and current spec to determine what gamepiece metadata to extract.
 */

import { describe, it, expect, beforeAll } from "@jest/globals";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { createMockState } from "#chaincraft/ai/design/graphs/main-design-graph/nodes/__tests__/test-utils.js";
import { planMetadata } from "#chaincraft/ai/design/graphs/gamepiece-metadata-subgraph/nodes/plan-metadata/index.js";
import { setupSpecPlanModel } from "#chaincraft/ai/model-config.js";

describe("Plan Metadata", () => {
  beforeAll(async () => {
    // Setup model for testing (using spec-plan model for now)
    await setupSpecPlanModel();
  }, 30000);

  it("should extract gamepiece types from specification", async () => {
    const state = createMockState({
      currentGameSpec: {
        summary: "A dice rolling adventure game where players quest for treasure",
        playerCount: { min: 2, max: 4 },
        designSpecification: `
# Dice Quest

## Overview
Players roll custom dice to overcome challenges and collect treasure in a fantasy adventure.

## Setup
Each player receives:
- 1 player board showing their character's stats
- 3 starting health tokens (red wooden cubes)
- 5 starting gold coins (yellow metal tokens)

Place in the center:
- The quest board with the adventure path
- 6 custom dice (each showing symbols: sword, shield, heart, star, moon, sun)
- Deck of 30 treasure cards (shuffled, face down)
- Pool of 40 point tokens (blue wooden discs)

## Gameplay
On your turn:
1. Roll the 6 dice and choose which to keep
2. Use sword symbols to defeat monsters
3. Use shield symbols for defense
4. Collect heart symbols to gain health tokens
5. Draw treasure cards when you complete a quest space

## Win Condition
First player to collect 20 points wins. Points come from treasure cards and completed quests.
        `,
        version: 1
      },
      messages: [
        new HumanMessage("Create a dice rolling game with custom dice and treasure")
      ],
      metadataUpdateNeeded: true,
    });

    const result = await planMetadata(state);

    expect(result.metadataPlan).toBeDefined();
    expect(result.metadataPlan?.metadataChangePlan).toBeDefined();
    expect(result.metadataPlan?.estimatedUniqueGamepieces).toBeDefined();
    
    const plan = result.metadataPlan?.metadataChangePlan || "";
    // Should identify all gamepiece types
    expect(plan.toLowerCase()).toContain("dice");
    expect(plan.toLowerCase()).toContain("board");
    expect(plan.toLowerCase()).toContain("card");
    expect(plan.toLowerCase()).toContain("token");
    // Should capture quantities
    expect(plan).toMatch(/6.*dice|dice.*6/i);
    expect(plan).toMatch(/30.*card|card.*30/i);
    
    // Should estimate reasonable number 
    // Possible components: 6 dice, 4 player boards, 1 quest board, treasure cards (spec says 30 - could be interpreted as types or copies), 3+ token types
    // LLM may interpret "30 treasure cards" as needing many unique types, pushing estimate >35
    expect(result.metadataPlan?.estimatedUniqueGamepieces).toBeGreaterThan(0);
    
    // If estimate is >35, chunking strategy should be present
    if (result.metadataPlan?.estimatedUniqueGamepieces && result.metadataPlan.estimatedUniqueGamepieces > 35) {
      expect(result.metadataPlan?.executionStrategy).toBeDefined();
    }
    
    console.log("\n=== EXTRACT FROM SPEC TEST ===");
    console.log(JSON.stringify(result.metadataPlan, null, 2));
  }, 60000);

  it("should extract specific instances from recent conversation not in spec", async () => {
    const state = createMockState({
      currentGameSpec: {
        summary: "A card battler game",
        playerCount: { min: 2, max: 2 },
        designSpecification: `
# Monster Card Battler

## Gameplay
Players take turns playing monster cards to battle. Each monster has attack and defense values.

## Components
- Deck of monster cards (quantity TBD)
- Health tracker for each player
        `,
        version: 1
      },
      messages: [
        new HumanMessage("Create a card battler game"),
        new AIMessage("I'll help you design a card battler. What kind of monsters do you want?"),
        new HumanMessage("I want a dragon card as one of the monsters - it should be really powerful"),
        new AIMessage("Great! I'll include a powerful dragon monster card in the design."),
      ],
      lastMetadataUpdate: undefined, // No previous metadata update
    });

    const result = await planMetadata(state);

    expect(result.metadataPlan).toBeDefined();
    expect(result.metadataPlan?.metadataChangePlan).toBeDefined();
    
    const plan = result.metadataPlan?.metadataChangePlan || "";
    // Should mention dragon specifically from conversation
    expect(plan.toLowerCase()).toContain("dragon");
    // Should mention monster cards from spec
    expect(plan.toLowerCase()).toContain("monster");
    // Should mention cards
    expect(plan.toLowerCase()).toContain("card");
    
    console.log("\n=== EXTRACT FROM MESSAGES TEST ===");
    console.log(JSON.stringify(result.metadataPlan, null, 2));
  }, 60000);

  it("should plan updates to existing metadata", async () => {
    const state = createMockState({
      currentGameSpec: {
        summary: "Rock Paper Scissors",
        playerCount: { min: 2, max: 2 },
        designSpecification: `
# Rock Paper Scissors

## Gameplay
Players simultaneously choose rock, paper, or scissors.
Rock beats scissors, scissors beats paper, paper beats rock.

## Components
- 3 choice tokens (rock, paper, scissors)
        `,
        version: 2
      },
      messages: [
        new HumanMessage("Add a fourth option called volcano that beats rock and scissors but loses to paper"),
      ],
      metadata: {
        gamepieceTypes: [
          { 
            id: "choice", 
            type: "token", 
            name: "Choice Token", 
            description: "Player's choice", 
            quantity: 3 
          }
        ],
        gamepieceInstances: [
          { 
            id: "rock", 
            type_id: "choice", 
            name: "Rock", 
            brief_description: "Rock choice",
            needs_expansion: false
          },
          { 
            id: "paper", 
            type_id: "choice", 
            name: "Paper", 
            brief_description: "Paper choice",
            needs_expansion: false
          },
          { 
            id: "scissors", 
            type_id: "choice", 
            name: "Scissors", 
            brief_description: "Scissors choice",
            needs_expansion: false
          },
        ]
      },
    });

    const result = await planMetadata(state);

    expect(result.metadataPlan).toBeDefined();
    expect(result.metadataPlan?.metadataChangePlan).toBeDefined();
    
    const plan = result.metadataPlan?.metadataChangePlan || "";
    expect(plan.toLowerCase()).toContain("volcano");
    expect(plan.toLowerCase()).toMatch(/add|new|fourth|4/);
    
    console.log("\n=== UPDATE METADATA TEST ===");
    console.log(JSON.stringify(result.metadataPlan, null, 2));
  }, 60000);

  it("should handle spec with no gamepieces mentioned", async () => {
    const state = createMockState({
      currentGameSpec: {
        summary: "A word guessing game",
        playerCount: { min: 2, max: 6 },
        designSpecification: `
# Word Guess

## Gameplay
Players take turns thinking of a word and others try to guess it.
        `,
        version: 1
      },
      messages: [
        new HumanMessage("Create a simple word guessing game"),
      ],
    });

    const result = await planMetadata(state);

    expect(result.metadataPlan).toBeDefined();
    expect(result.metadataPlan?.metadataChangePlan).toBeDefined();
    
    // Should have very few components (0-5)
    // LLM may infer basic components like score pads, pencils, or turn markers even if not explicitly mentioned
    expect(result.metadataPlan?.estimatedUniqueGamepieces).toBeLessThan(10);
    expect(result.metadataPlan?.executionStrategy).toBeUndefined(); // Definitely no chunking needed
    
    // Should indicate minimal/no physical components
    expect(result.metadataPlan?.metadataChangePlan.toLowerCase()).toMatch(/no|none|minimal|verbal|simple|basic/);
    
    console.log("\n=== NO GAMEPIECES TEST ===");
    console.log(JSON.stringify(result.metadataPlan, null, 2));
  }, 60000);

  it("should recommend chunking strategy for large games (>35 unique pieces)", async () => {
    const state = createMockState({
      currentGameSpec: {
        summary: "A collectible creature card game with diverse rarities",
        playerCount: { min: 2, max: 2 },
        designSpecification: `
# Creature Card Battle

## Overview
A strategic card game where players collect and battle with fantasy creatures across different rarity tiers.

## Components
- 100 unique creature cards distributed across rarity tiers:
  - 10 Legendary creatures (most powerful, 1 copy each)
  - 20 Epic creatures (very strong, 2 copies each)
  - 30 Rare creatures (balanced power, 3 copies each)
  - 40 Common creatures (basic units, 5 copies each)

Each creature has unique abilities based on elemental themes: fire, water, earth, and air.

Total deck: 320 cards (100 unique × varying copies by rarity)

## Gameplay
Players build decks and battle using creature abilities and elemental synergies.
        `,
        version: 1
      },
      messages: [
        new HumanMessage("Create a creature card game with 100 unique creatures across different rarity tiers"),
      ],
    });

    const result = await planMetadata(state);

    expect(result.metadataPlan).toBeDefined();
    expect(result.metadataPlan?.metadataChangePlan).toBeDefined();
    
    // Should estimate correctly (100 unique creatures)
    expect(result.metadataPlan?.estimatedUniqueGamepieces).toBeGreaterThan(35);
    expect(result.metadataPlan?.estimatedUniqueGamepieces).toBeGreaterThanOrEqual(100);
    
    // Should include chunking strategy
    expect(result.metadataPlan?.executionStrategy).toBeDefined();
    expect(result.metadataPlan?.executionStrategy?.chunks).toBeDefined();
    expect(result.metadataPlan?.executionStrategy?.chunks.length).toBeGreaterThan(1);
    
    // Verify chunk structure
    const chunks = result.metadataPlan?.executionStrategy?.chunks || [];
    
    console.log("\n=== CHUNKING TEST OUTPUT ===");
    console.log(`Total estimated: ${result.metadataPlan?.estimatedUniqueGamepieces}`);
    console.log(`Number of chunks: ${chunks.length}`);
    chunks.forEach((chunk, i) => {
      console.log(`\nChunk ${i + 1}:`);
      console.log(`  ID: ${chunk.id}`);
      console.log(`  Instances: ${chunk.estimatedInstances}`);
      console.log(`  Boundary: ${chunk.boundary}`);
      console.log(`  Description: ${chunk.description}`);
    });
    
    chunks.forEach(chunk => {
      expect(chunk.id).toBeDefined();
      expect(chunk.description).toBeDefined();
      expect(chunk.boundary).toBeDefined();
      expect(chunk.estimatedInstances).toBeGreaterThan(0);
      expect(chunk.estimatedInstances).toBeLessThanOrEqual(35); // Each chunk should be <= 35
    });
    
    // Verify total adds up
    const totalEstimated = chunks.reduce((sum, chunk) => sum + chunk.estimatedInstances, 0);
    expect(totalEstimated).toBeGreaterThanOrEqual(100);
    
    console.log("\n=== CHUNKING STRATEGY TEST ===");
    console.log(`Estimated unique gamepieces: ${result.metadataPlan?.estimatedUniqueGamepieces}`);
    console.log(`Number of chunks: ${chunks.length}`);
    console.log("\nChunks:");
    chunks.forEach((chunk, i) => {
      console.log(`  ${i + 1}. ${chunk.id} (${chunk.estimatedInstances} instances)`);
      console.log(`     Boundary: ${chunk.boundary}`);
      console.log(`     Description: ${chunk.description}`);
    });
    console.log("\nFull plan:");
    console.log(JSON.stringify(result.metadataPlan, null, 2));
  }, 90000); // Longer timeout for complex planning
});
