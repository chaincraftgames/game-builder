/**
 * Execute Metadata Node Tests
 * 
 * Tests the metadata execution functionality that generates structured
 * gamepiece metadata from natural language extraction plans.
 */

import { describe, it, expect, beforeAll } from "@jest/globals";
import { HumanMessage } from "@langchain/core/messages";
import { createMockState } from "#chaincraft/ai/design/graphs/main-design-graph/nodes/__tests__/test-utils.js";
import { executeMetadata } from "#chaincraft/ai/design/graphs/gamepiece-metadata-subgraph/nodes/execute-metadata/index.js";
import { setupSpecExecuteModel } from "#chaincraft/ai/model-config.js";

describe("Execute Metadata", () => {
  beforeAll(async () => {
    // Setup model for testing (uses Sonnet for high-quality structured output)
    await setupSpecExecuteModel();
  }, 30000);

  it("should extract RPS gamepieces from plan", async () => {
    const state = createMockState({
      metadataChangePlan: `Extract gamepiece metadata for Rock Paper Scissors.

Gamepiece Types to Extract:
- Choice tokens (quantity: 3, rock/paper/scissors)
  - rock: beats scissors, loses to paper
  - paper: beats rock, loses to scissors  
  - scissors: beats paper, loses to rock

All instances are simple and don't need content expansion.`,
      currentGameSpec: {
        summary: "Rock Paper Scissors",
        playerCount: { min: 2, max: 2 },
        designSpecification: "Classic RPS game",
        version: 1
      },
    });

    const result = await executeMetadata(state);

    // Verify structure
    expect(result.metadata).toBeDefined();
    expect(result.metadata.gamepieceTypes).toHaveLength(1);
    expect(result.metadata.gamepieceInstances).toHaveLength(3);

    // Verify type
    const rpsType = result.metadata.gamepieceTypes[0];
    expect(rpsType.id).toMatch(/^[a-z][a-z0-9_]*$/);
    // Type can be "token" or "other" - both are valid for choice pieces
    expect(["token", "other"]).toContain(rpsType.type);
    expect(rpsType.quantity).toBe(3);
    expect(rpsType.instances).toHaveLength(3);

    // Verify instances
    const instances = result.metadata.gamepieceInstances;
    const ids = instances.map(i => i.id);
    expect(ids).toContain("rock");
    expect(ids).toContain("paper");
    expect(ids).toContain("scissors");

    // Verify all have required fields
    instances.forEach(inst => {
      expect(inst.id).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(inst.name).toBeTruthy();
      expect(inst.brief_description).toBeTruthy();
      expect(inst.brief_description.length).toBeGreaterThan(10);
      expect(typeof inst.needs_expansion).toBe("boolean");
      expect(inst.type_id).toBe(rpsType.id);
    });

    // Verify copy_count defaults
    instances.forEach(inst => {
      // copy_count should default to 1 or be explicitly 1
      const count = (inst as any).copy_count;
      if (count !== undefined) {
        expect(count).toBe(1);
      }
    });

    console.log("\n=== RPS EXTRACTION TEST ===");
    console.log(JSON.stringify(result.metadata, null, 2));
  }, 60000);

  it("should extract Dice Quest gamepieces with multiple types", async () => {
    const state = createMockState({
      metadataChangePlan: `Extract gamepiece metadata for Dice Quest.

Gamepiece Types to Extract:
- Custom dice (quantity: 6, each die shows: sword, shield, heart, star, moon, sun symbols)
- Player boards (quantity: 4, one per player, shows character stats)
- Quest board (quantity: 1, central adventure path board)
- Treasure cards (quantity: 10, simple reward cards - mark for expansion as they need abilities)
- Health tokens (quantity: 12, red cubes for tracking health)

Create one instance per die (6 total), one per player board (4 total), one quest board, representative treasure cards (5 unique), and one health token instance (with copy_count: 12).`,
      currentGameSpec: {
        summary: "A dice rolling adventure game",
        playerCount: { min: 2, max: 4 },
        designSpecification: "Dice quest game",
        version: 1
      },
    });

    const result = await executeMetadata(state);

    // Verify structure
    expect(result.metadata).toBeDefined();
    expect(result.metadata.gamepieceTypes.length).toBeGreaterThanOrEqual(5);

    // Verify types exist
    const typeIds = result.metadata.gamepieceTypes.map(t => t.id);
    const typeCategories = result.metadata.gamepieceTypes.map(t => t.type);
    
    expect(typeCategories).toContain("dice");
    expect(typeCategories).toContain("board");
    expect(typeCategories).toContain("card");
    expect(typeCategories).toContain("token");

    // Verify quantities match
    const diceType = result.metadata.gamepieceTypes.find(t => t.type === "dice");
    expect(diceType?.quantity).toBe(6);

    const cardType = result.metadata.gamepieceTypes.find(t => t.type === "card");
    expect(cardType?.quantity).toBe(10);

    // Verify treasure cards have instances (not using template)
    expect(cardType?.instances.length).toBeGreaterThan(0);
    
    // Verify treasure card instances need expansion
    const treasureInstances = result.metadata.gamepieceInstances.filter(
      i => i.type_id === cardType?.id
    );
    const someNeedExpansion = treasureInstances.some(i => i.needs_expansion);
    expect(someNeedExpansion).toBe(true);
    
    // Verify health tokens use copy_count
    const tokenType = result.metadata.gamepieceTypes.find(t => t.type === "token");
    const healthToken = tokenType?.instances[0];
    if (healthToken) {
      expect((healthToken as any).copy_count).toBe(12);
    }

    console.log("\n=== DICE QUEST EXTRACTION TEST ===");
    console.log(`Types: ${result.metadata.gamepieceTypes.length}`);
    console.log(`Instances: ${result.metadata.gamepieceInstances.length}`);
    result.metadata.gamepieceTypes.forEach(type => {
      console.log(`  - ${type.id} (${type.type}): ${type.quantity} total, ${type.instances.length} unique`);
    });
  }, 60000);

  it("should update RPS to add volcano option", async () => {
    const state = createMockState({
      metadataChangePlan: `Update gamepiece metadata for Rock Paper Scissors to add a fourth choice.

Updates Needed:
- Update quantity from 3 to 4
- Add new instance: volcano
  - volcano: beats rock and scissors, loses to paper
  
Keep existing rock, paper, scissors instances unchanged.`,
      currentGameSpec: {
        summary: "Rock Paper Scissors with volcano",
        playerCount: { min: 2, max: 2 },
        designSpecification: "RPS with volcano option",
        version: 2
      },
      metadata: {
        gamepieceTypes: [
          { 
            id: "choice", 
            type: "other", 
            quantity: 3,
            description: "Player choices",
            template: "",
            instances: [
              { id: "rock", name: "Rock", brief_description: "Rock choice", needs_expansion: false },
              { id: "paper", name: "Paper", brief_description: "Paper choice", needs_expansion: false },
              { id: "scissors", name: "Scissors", brief_description: "Scissors choice", needs_expansion: false },
            ]
          }
        ],
        gamepieceInstances: [
          { id: "rock", type_id: "choice", name: "Rock", brief_description: "Rock choice", needs_expansion: false },
          { id: "paper", type_id: "choice", name: "Paper", brief_description: "Paper choice", needs_expansion: false },
          { id: "scissors", type_id: "choice", name: "Scissors", brief_description: "Scissors choice", needs_expansion: false },
        ]
      },
    });

    const result = await executeMetadata(state);

    // Verify structure
    expect(result.metadata).toBeDefined();
    expect(result.metadata.gamepieceTypes).toHaveLength(1);
    expect(result.metadata.gamepieceInstances).toHaveLength(4);

    // Verify updated quantity
    const choiceType = result.metadata.gamepieceTypes[0];
    expect(choiceType.quantity).toBe(4);
    expect(choiceType.instances).toHaveLength(4);

    // Verify all instances exist
    const ids = result.metadata.gamepieceInstances.map(i => i.id);
    expect(ids).toContain("rock");
    expect(ids).toContain("paper");
    expect(ids).toContain("scissors");
    expect(ids).toContain("volcano");

    // Verify volcano instance
    const volcano = result.metadata.gamepieceInstances.find(i => i.id === "volcano");
    expect(volcano).toBeDefined();
    expect(volcano?.name).toContain("Volcano");
    expect(volcano?.brief_description.toLowerCase()).toContain("rock");
    expect(volcano?.brief_description.toLowerCase()).toContain("scissors");

    console.log("\n=== UPDATE RPS WITH VOLCANO TEST ===");
    console.log(JSON.stringify(result.metadata, null, 2));
  }, 60000);

  it("should handle spec with no gamepieces", async () => {
    const state = createMockState({
      metadataChangePlan: `Extract gamepiece metadata for a word guessing game.

Gamepiece Types to Extract:
None - this is a purely verbal game with no physical components.

The game is played with spoken words only, no cards, tokens, or boards are needed.`,
      currentGameSpec: {
        summary: "A word guessing game",
        playerCount: { min: 2, max: 6 },
        designSpecification: "Players guess words",
        version: 1
      },
    });

    const result = await executeMetadata(state);

    // Verify structure
    expect(result.metadata).toBeDefined();
    expect(result.metadata.gamepieceTypes).toHaveLength(0);
    expect(result.metadata.gamepieceInstances).toHaveLength(0);

    console.log("\n=== NO GAMEPIECES TEST ===");
    console.log(JSON.stringify(result.metadata, null, 2));
  }, 60000);

  it("should handle copy_count with rarity distribution", async () => {
    const state = createMockState({
      metadataChangePlan: `Extract 30 unique spell cards with rarity tiers. Total: 80 cards.
- 10 legendary spells (1 copy each) = 10 cards
- 10 rare spells (2 copies each) = 20 cards  
- 10 common spells (5 copies each) = 50 cards

Spell types: fire (offensive damage), water (defensive shields), earth (utility/healing), air (movement/speed). Create diverse spell names and descriptions across all rarity tiers and themes.`,
      currentGameSpec: {
        summary: "Spell card battle game",
        playerCount: { min: 2, max: 4 },
        designSpecification: "Players cast spell cards",
        version: 1
      },
    });

    const result = await executeMetadata(state);

    // Verify structure
    expect(result.metadata).toBeDefined();
    expect(result.metadata.gamepieceTypes).toHaveLength(1);

    const spellType = result.metadata.gamepieceTypes[0];
    expect(spellType.type).toBe("card");
    expect(spellType.quantity).toBe(80);
    
    // Should have 30 unique instances
    expect(spellType.instances.length).toBe(30);

    // Verify rarity distribution with correct copy counts
    const legendaries = spellType.instances.filter(i => (i as any).copy_count === 1);
    const rares = spellType.instances.filter(i => (i as any).copy_count === 2);
    const commons = spellType.instances.filter(i => (i as any).copy_count === 5);

    expect(legendaries.length).toBe(10);
    expect(rares.length).toBe(10);
    expect(commons.length).toBe(10);

    // Verify total equals 80
    const totalCopies = (legendaries.length * 1) + (rares.length * 2) + (commons.length * 5);
    expect(totalCopies).toBe(80);

    console.log("\n=== RARITY DISTRIBUTION TEST ===");
    console.log(`Total cards: ${totalCopies}`);
    console.log(`Legendary (×1): ${legendaries.length} unique = ${legendaries.length * 1} cards`);
    console.log(`Rare (×2): ${rares.length} unique = ${rares.length * 2} cards`);
    console.log(`Common (×5): ${commons.length} unique = ${commons.length * 5} cards`);
    console.log("\nSample instances:");
    [
      legendaries[0], 
      rares[0], 
      commons[0]
    ].filter(Boolean).forEach(inst => {
      console.log(`  - ${inst.name} (×${(inst as any).copy_count}): ${inst.brief_description}`);
    });
  }, 60000);

  it("should handle resource cards with copy_count", async () => {
    const state = createMockState({
      metadataChangePlan: `Extract gamepiece metadata for a resource collection game.

Gamepiece Types to Extract:
- Resource cards (quantity: 95, five types with 19 copies each)
  - wood: lumber from forests, used for building
  - brick: clay from hills, used for building
  - sheep: wool from pastures, used for trading
  - wheat: grain from fields, used for development
  - ore: metal from mountains, used for cities
  
Each resource card type has 19 identical copies. Mark copy_count as 19 for each.`,
      currentGameSpec: {
        summary: "Resource collection game",
        playerCount: { min: 2, max: 4 },
        designSpecification: "Collect and trade resources",
        version: 1
      },
    });

    const result = await executeMetadata(state);

    // Verify structure
    expect(result.metadata).toBeDefined();
    expect(result.metadata.gamepieceTypes).toHaveLength(1);

    const resourceType = result.metadata.gamepieceTypes[0];
    expect(resourceType.quantity).toBe(95);
    expect(resourceType.instances).toHaveLength(5);

    // Verify instances have copy_count
    resourceType.instances.forEach(inst => {
      expect((inst as any).copy_count).toBe(19);
    });

    // Verify sum of copy_counts equals quantity
    const totalCopies = resourceType.instances.reduce(
      (sum, inst) => sum + ((inst as any).copy_count || 1), 
      0
    );
    expect(totalCopies).toBe(95);

    console.log("\n=== RESOURCE CARDS WITH COPY_COUNT TEST ===");
    console.log(JSON.stringify(result.metadata, null, 2));
  }, 60000);
});
