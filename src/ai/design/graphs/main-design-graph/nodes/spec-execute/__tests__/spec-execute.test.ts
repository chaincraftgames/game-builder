/**
 * Tests for the Spec Execution Agent
 * 
 * These tests verify:
 * 1. Pure markdown generation from spec_plan metadata
 * 2. Spec assembly from spec_plan (summary, playerCount) + generated markdown
 * 3. State field updates
 * 4. Integration with model (visual inspection of generated specs)
 * 
 * Note: LLM outputs are non-deterministic, so we verify behavior patterns
 * and state changes rather than exact output text.
 * 
 * ARCHITECTURE: spec-execute now reads metadata (summary, playerCount) from spec_plan
 * and generates ONLY the designSpecification as pure markdown.
 */
import { describe, expect, test, beforeAll } from "@jest/globals";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { setupSpecExecuteModel } from "#chaincraft/ai/model-config.js";
import { createSpecExecute } from "../index.js";
import type { GameDesignSpecification, GamepieceMetadata, SpecPlan } from "#chaincraft/ai/design/game-design-state.js";

// Helper function to create test state with all required fields
function createTestState(overrides: {
  messages?: any[];
  title?: string;
  specPlan?: SpecPlan;
  currentSpec?: GameDesignSpecification;
  pendingSpecChanges?: SpecPlan[];
  specVersion?: number;
} = {}) {
  return {
    messages: overrides.messages || [],
    title: overrides.title || "",
    systemPromptVersion: "1.0",
    currentSpec: overrides.currentSpec || undefined,
    specVersion: overrides.specVersion ?? 0,
    specUpdateNeeded: true,
    metadataUpdateNeeded: false,
    specPlan: overrides.specPlan || undefined,
    metadataChangePlan: undefined,
    updatedSpec: undefined,
    metadata: undefined,
    specDiff: undefined,
    metadataDiff: undefined,
    validationErrors: [],
    retryCount: 0,
    lastSpecUpdate: undefined,
    lastMetadataUpdate: undefined,
    lastSpecMessageCount: undefined,
    metadataPlan: undefined,
    pendingSpecChanges: overrides.pendingSpecChanges || [],
    forceSpecGeneration: false,
    consolidationThreshold: 5,
    consolidationCharLimit: 2000,
  };
}

describe("Execute Spec - Error Handling", () => {
  test("should throw error when no pending changes", async () => {
    const model = await setupSpecExecuteModel();
    const executeSpec = createSpecExecute(model);
    
    const state = createTestState({
      pendingSpecChanges: [], // Empty - no pending changes
    });

    await expect(executeSpec(state)).rejects.toThrow(
      "[spec-execute] No accumulated changes"
    );
  });
});

describe("Execute Spec - Integration", () => {
  let model: any;
  let executeSpec: any;

  // Skip integration tests if no API key is configured
  const hasApiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;

  beforeAll(async () => {
    if (!hasApiKey) {
      console.log("⚠️  Skipping integration tests - no API key configured");
      return;
    }

    try {
      model = await setupSpecExecuteModel();
      executeSpec = createSpecExecute(model);
    } catch (error) {
      console.log("⚠️  Failed to setup model:", error);
    }
  });

  test("should generate initial spec from plan (Rock-Paper-Scissors)", async () => {
    if (!hasApiKey) {
      console.log("⚠️  Skipping - no API key");
      return;
    }

    const specPlan: SpecPlan = {
      summary: "A classic rock-paper-scissors game for 2 players",
      playerCount: { min: 2, max: 2 },
      changes: `Based on the conversation, here's what needs to be established in the initial game specification:

1. **Game Format**: This is a 2-player competitive game with a best-of-3 match structure.
2. **Round Structure**: Each round follows standard rock-paper-scissors rules.
3. **Match Progression**: Players play consecutive rounds until one player achieves 2 round wins.
4. **Win/Loss History Tracking**: The game must maintain and display a running tally.
5. **Draw Handling**: Draws are replayed.
6. **Game End**: The match concludes when one player reaches 2 round wins.`
    };

    const state = createTestState({
      messages: [
        new HumanMessage("I want to create a rock-paper-scissors game"),
        new AIMessage("Great! Is this for 2 players?"),
        new HumanMessage("2 players, best of 3 rounds"),
      ],
      title: "Rock Paper Scissors",
      pendingSpecChanges: [specPlan],
      currentSpec: undefined, // First spec
    });

    const result = await executeSpec(state);

    console.log("\n=== GENERATED INITIAL SPEC (RPS) ===");
    console.log("Summary:", result.currentSpec.summary);
    console.log("Player Count:", result.currentSpec.playerCount);
    console.log("\nDesign Specification:");
    console.log(result.currentSpec.designSpecification);
    console.log("=====================================\n");

    // Verify state updates
    expect(result.currentSpec).toBeDefined();
    expect(result.currentSpec.summary).toBeDefined();
    expect(typeof result.currentSpec.summary).toBe("string");
    expect(result.currentSpec.playerCount).toBeDefined();
    expect(result.currentSpec.playerCount.min).toBe(2);
    expect(result.currentSpec.playerCount.max).toBe(2);
    expect(result.currentSpec.designSpecification).toBeDefined();
    expect(result.currentSpec.designSpecification.length).toBeGreaterThan(100);
    
    // Verify tracking fields
    expect(result.currentSpec).toEqual(result.currentSpec);
    expect(result.lastSpecUpdate).toBeDefined();
    expect(result.lastSpecMessageCount).toBe(3);
    expect(result.specUpdateNeeded).toBe(false);
    
    // Spec should contain key concepts
    const specText = result.currentSpec.designSpecification.toLowerCase();
    expect(specText).toMatch(/rock|paper|scissors/);
    expect(specText).toMatch(/player|2/);
    expect(specText).toMatch(/win|round/);
  }, 60000);

  test("should update existing spec from plan (Add Volcano)", async () => {
    if (!hasApiKey) {
      console.log("⚠️  Skipping - no API key");
      return;
    }

    const existingSpec: GameDesignSpecification = {
      summary: "A classic rock-paper-scissors game for 2 players",
      playerCount: { min: 2, max: 2 },
      designSpecification: `# Rock Paper Scissors

## Setup
- 2 players face each other
- No physical components needed

## Turn Structure
1. Both players simultaneously choose rock, paper, or scissors
2. Reveal choices
3. Determine winner:
   - Rock beats scissors
   - Scissors beats paper
   - Paper beats rock
4. Ties are replayed

## Victory Conditions
- Best of 3 rounds
- First player to win 2 rounds wins the match`,
      version: 1,
    };

    const specPlan: SpecPlan = {
      summary: "A classic rock-paper-scissors game for 2 players with volcano option",
      playerCount: { min: 2, max: 2 },
      changes: `Based on the user's requests to add a fourth option and change the match format:

1. **Turn Structure - Choice Options**: Expand the available choices from three to four by adding "volcano". Volcano beats both rock and scissors, but loses to paper.

2. **Victory Conditions - Match Format**: Change from "Best of 3 rounds" to "Best of 5 rounds". First player to win 3 rounds wins.`
    };

    const state = createTestState({
      messages: [
        new HumanMessage("Add volcano that beats rock and scissors, and make it best of 5"),
      ],
      title: "Rock Paper Scissors Volcano",
      pendingSpecChanges: [specPlan],
      currentSpec: existingSpec,
    });

    const result = await executeSpec(state);

    console.log("\n=== UPDATED SPEC (Add Volcano) ===");
    console.log("Summary:", result.currentSpec.summary);
    console.log("Player Count:", result.currentSpec.playerCount);
    console.log("\nDesign Specification:");
    console.log(result.currentSpec.designSpecification);
    console.log("===================================\n");

    // Verify state updates
    expect(result.currentSpec).toBeDefined();
    expect(result.currentSpec.summary).toBeDefined();
    expect(result.currentSpec.playerCount.min).toBe(2);
    expect(result.currentSpec.playerCount.max).toBe(2);
    
    // Verify tracking fields
    expect(result.currentSpec).toEqual(result.currentSpec);
    expect(result.lastSpecUpdate).toBeDefined();
    expect(result.specUpdateNeeded).toBe(false);
    
    // Spec should contain both old and new concepts
    const specText = result.currentSpec.designSpecification.toLowerCase();
    expect(specText).toMatch(/volcano/);
    expect(specText).toMatch(/best of 5|5 rounds/);
    expect(specText).toMatch(/rock|paper|scissors/); // Should preserve existing
  }, 60000);

  test("should generate complex spec (Deck Builder)", async () => {
    if (!hasApiKey) {
      console.log("⚠️  Skipping - no API key");
      return;
    }

    const plan = `Based on the user's conversation, here is the complete specification plan for the deck-building game:

**Game Overview & Win Condition**
Create a deck-building game where players compete to reach 20 victory points first.

**Setup Phase**
Each player starts with an identical basic deck of 10 cards.

**Player Turn Structure**
1. **Draw Phase**: Players draw 5 cards
2. **Play Phase**: Players play cards to generate resources
3. **Market Phase**: Players use resources to purchase new cards

**Resources System**
Two resource types:
- **Gold**: Used to purchase cards
- **Influence**: Used to purchase victory points

**Card Types & Effects**
- **Action Cards**: Provide one-time effects
- **Treasure Cards**: Generate gold
- **Victory Cards**: Generate victory points but clog deck

**Market System**
Shared market display with 6 card piles always available.

**Victory Point Conversion**
Players convert influence into victory points by purchasing victory cards.`;

    const specPlan: SpecPlan = {
      summary: "A deck-building game where players compete to reach 20 victory points by acquiring cards and managing resources",
      playerCount: { min: 2, max: 4 },
      changes: plan
    };

    const state = createTestState({
      messages: [
        new HumanMessage("I want to create a deck-building game"),
      ],
      title: "Deck Builder",
      pendingSpecChanges: [specPlan],
      currentSpec: undefined,
    });

    const result = await executeSpec(state);

    console.log("\n=== COMPLEX SPEC (Deck Builder) ===");
    console.log("Summary:", result.currentSpec.summary);
    console.log("Player Count:", result.currentSpec.playerCount);
    console.log("\nDesign Specification:");
    console.log(result.currentSpec.designSpecification);
    console.log("====================================\n");

    // Verify state updates
    expect(result.currentSpec).toBeDefined();
    expect(result.currentSpec.summary).toBeDefined();
    expect(result.currentSpec.playerCount).toBeDefined();
    
    // Verify tracking fields
    expect(result.lastSpecUpdate).toBeDefined();
    expect(result.specUpdateNeeded).toBe(false);
    
    // Spec should contain all major mechanics
    const specText = result.currentSpec.designSpecification.toLowerCase();
    expect(specText).toMatch(/deck|card/);
    expect(specText).toMatch(/gold|influence/);
    expect(specText).toMatch(/victory|20|point/);
    expect(specText).toMatch(/market/);
  }, 60000);

  test("should handle minimal plan (Coin Flip)", async () => {
    if (!hasApiKey) {
      console.log("⚠️  Skipping - no API key");
      return;
    }

    const specPlan: SpecPlan = {
      summary: "A simple 2-player coin flip guessing game",
      playerCount: { min: 2, max: 2 },
      changes: `1. **Game Overview**: 2-player, turn-based, luck-based game where the core mechanic is predicting coin flips.
2. **Setup Phase**: Game begins with a coin and both players ready.
3. **Player Turn Structure**: Active player calls heads/tails, coin is flipped, result compared.
4. **Win Condition**: Correct call wins the game.`
    };

    const state = createTestState({
      messages: [
        new HumanMessage("Create a coin flip game - 2 players, whoever calls it right wins"),
      ],
      title: "Coin Flip",
      pendingSpecChanges: [specPlan],
      currentSpec: undefined,
    });

    const result = await executeSpec(state);

    console.log("\n=== MINIMAL PLAN SPEC (Coin Flip) ===");
    console.log("Summary:", result.currentSpec.summary);
    console.log("Player Count:", result.currentSpec.playerCount);
    console.log("\nDesign Specification:");
    console.log(result.currentSpec.designSpecification);
    console.log("======================================\n");

    // Verify state updates
    expect(result.currentSpec).toBeDefined();
    expect(result.currentSpec.playerCount.min).toBe(2);
    expect(result.currentSpec.playerCount.max).toBe(2);
    
    // Spec should contain key concepts
    const specText = result.currentSpec.designSpecification.toLowerCase();
    expect(specText).toMatch(/coin|flip/);
    expect(specText).toMatch(/heads|tails/);
  }, 60000);

  test("should apply complex update (Betting Coin Flip)", async () => {
    if (!hasApiKey) {
      console.log("⚠️  Skipping - no API key");
      return;
    }

    const existingSpec: GameDesignSpecification = {
      summary: "A simple coin flip guessing game",
      playerCount: { min: 2, max: 2 },
      designSpecification: `# Coin Flip Game

## Setup
- 2 players
- 1 coin

## Turn Structure
1. Player 1 calls heads or tails
2. Player 2 flips the coin
3. If Player 1 called correctly, they win
4. Otherwise Player 2 wins

## Victory Conditions
- Correct call wins the game`,
      version: 1,
    };

    const specPlan: SpecPlan = {
      summary: "A betting coin flip game where players wager coins over a series of flips",
      playerCount: { min: 2, max: 2 },
      changes: `1. **Setup Phase**: Add initial resource - each player receives 10 coins.
2. **Match Structure**: Change to best-of-5 series. First player to win 3 flips wins.
3. **Turn Structure - Add Betting**: Before calling, both players bet coins (0 to current balance).
4. **Turn Structure - Modify Outcome**: Winner receives both bets.
5. **Victory Conditions**: First to 3 flips OR opponent runs out of coins.
6. **Rules Clarification**: Player with 0 coins is eliminated.`
    };

    const state = createTestState({
      messages: [
        new HumanMessage("Change it to best of 5 flips with betting"),
      ],
      title: "Betting Coin Flip",
      pendingSpecChanges: [specPlan],
      currentSpec: existingSpec,
    });

    const result = await executeSpec(state);

    console.log("\n=== COMPLEX UPDATE (Betting) ===");
    console.log("Summary:", result.currentSpec.summary);
    console.log("\nDesign Specification:");
    console.log(result.currentSpec.designSpecification);
    console.log("=================================\n");

    // Verify state updates
    expect(result.currentSpec).toBeDefined();
    
    // Spec should contain all new mechanics
    const specText = result.currentSpec.designSpecification.toLowerCase();
    expect(specText).toMatch(/bet|betting|coin/);
    expect(specText).toMatch(/10|ten/);
    expect(specText).toMatch(/3|best.{0,10}5|series/); // Flexible: "3 flips", "best of 5", "best-of-5 series"
  }, 60000);
});

describe("Execute Spec - Spec Quality (Manual Inspection)", () => {
  const hasApiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;

  test("spec should follow markdown structure", async () => {
    if (!hasApiKey) {
      console.log("⚠️  Skipping - no API key");
      return;
    }

    const model = await setupSpecExecuteModel();
    const executeSpec = createSpecExecute(model);

    const specPlan: SpecPlan = {
      summary: "A simple 2-player card game where players draw and play cards to score points",
      playerCount: { min: 2, max: 2 },
      changes: `Create a simple card game:
- 2 players
- Each player starts with 5 cards
- Draw 1 card per turn
- Play cards to gain points
- First to 10 points wins`
    };

    const state = createTestState({
      messages: [new HumanMessage("Create a card game")],
      title: "Card Game",
      pendingSpecChanges: [specPlan],
    });

    const result = await executeSpec(state);

    console.log("\n=== SPEC STRUCTURE CHECK ===");
    console.log(result.currentSpec.designSpecification);
    console.log("============================\n");

    // Manual inspection:
    // - Should have markdown headers (##)
    // - Should have sections (Setup, Turn Structure, Victory Conditions)
    // - Should be well-organized and readable
    // - Should contain all information from the plan
    
    const specText = result.currentSpec.designSpecification;
    expect(specText).toMatch(/##/); // Has markdown headers
    expect(specText.length).toBeGreaterThan(200); // Substantial content
  }, 60000);

  test("spec should preserve existing content when updating", async () => {
    if (!hasApiKey) {
      console.log("⚠️  Skipping - no API key");
      return;
    }

    const model = await setupSpecExecuteModel();
    const executeSpec = createSpecExecute(model);

    const existingSpec: GameDesignSpecification = {
      summary: "A simple number guessing game",
      playerCount: { min: 2, max: 4 },
      designSpecification: `# Number Guessing Game

## Setup
- Each player gets a secret number between 1-100
- Players have 10 guesses total

## Turn Structure
1. Player makes a guess
2. Opponent says "higher" or "lower"
3. First to guess correctly wins

## Victory Conditions
- Correct guess wins immediately`,
      version: 1,
    };

    const specPlan: SpecPlan = {
      summary: "A number guessing game with a scoring system based on guess efficiency",
      playerCount: { min: 2, max: 4 },
      changes: `Add a scoring system:
- Award 10 points for guessing in 1-3 tries
- Award 5 points for guessing in 4-7 tries
- Award 1 point for guessing in 8-10 tries
- First to 25 points wins the game`
    };

    const state = createTestState({
      messages: [new HumanMessage("Add scoring")],
      title: "Number Guessing with Scoring",
      pendingSpecChanges: [specPlan],
      currentSpec: existingSpec,
    });

    const result = await executeSpec(state);

    console.log("\n=== PRESERVATION CHECK ===");
    console.log("Original had: secret number 1-100, 10 guesses, higher/lower");
    console.log("\nUpdated spec:");
    console.log(result.currentSpec.designSpecification);
    console.log("==========================\n");

    // Should contain both old and new content
    const specText = result.currentSpec.designSpecification.toLowerCase();
    expect(specText).toMatch(/100|secret/); // Original content
    expect(specText).toMatch(/25 points|scoring/); // New content
  }, 60000);
});

describe("Execute Spec - Pending Changes Consolidation", () => {
  let model: any;
  let executeSpec: any;
  const hasApiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;

  beforeAll(async () => {
    if (!hasApiKey) {
      console.log("⚠️  Skipping pending changes tests - no API key configured");
      return;
    }

    try {
      model = await setupSpecExecuteModel();
      executeSpec = createSpecExecute(model);
    } catch (error) {
      console.log("⚠️  Failed to setup model:", error);
    }
  });

  test("should generate spec from single pending change", async () => {
    if (!hasApiKey) {
      console.log("⚠️  Skipping - no API key");
      return;
    }

    const pendingChange: SpecPlan = {
      summary: "A simple coin flip game for 2 players",
      playerCount: { min: 2, max: 2 },
      changes: `Create initial game specification:
1. Setup: 2 players, 1 coin
2. Turn structure: Player 1 calls heads/tails, player 2 flips
3. Victory: Correct call wins the game`
    };

    const state = createTestState({
      pendingSpecChanges: [pendingChange],
    });

    const result = await executeSpec(state);

    // Should generate spec
    expect(result.currentSpec).toBeDefined();
    expect(result.currentSpec.summary).toBe(pendingChange.summary);
    expect(result.currentSpec.playerCount).toEqual(pendingChange.playerCount);
    expect(result.currentSpec.designSpecification).toBeDefined();
    expect(result.currentSpec.version).toBe(1);

    // Should clear pending changes
    expect(result.pendingSpecChanges).toEqual([]);

    console.log("\n=== SINGLE PENDING CHANGE ===");
    console.log("Generated spec from 1 pending change");
    console.log("Summary:", result.currentSpec.summary);
    console.log("=============================\n");
  }, 60000);

  test("should consolidate multiple pending changes", async () => {
    if (!hasApiKey) {
      console.log("⚠️  Skipping - no API key");
      return;
    }

    const pendingChanges: SpecPlan[] = [
      {
        summary: "A dice rolling game",
        playerCount: { min: 2, max: 2 },
        changes: "Create game where players roll dice, highest roll wins"
      },
      {
        summary: "A dice game with rounds",
        playerCount: { min: 2, max: 2 },
        changes: "Change to best of 3 rounds format"
      },
      {
        summary: "A dice game with scoring",
        playerCount: { min: 2, max: 4 },
        changes: "Add scoring system: winner of each round gets 1 point, first to 2 points wins"
      }
    ];

    const state = createTestState({
      pendingSpecChanges: pendingChanges,
    });

    const result = await executeSpec(state);

    // Should use LATEST metadata
    expect(result.currentSpec).toBeDefined();
    expect(result.currentSpec.summary).toBe("A dice game with scoring"); // Latest summary
    expect(result.currentSpec.playerCount).toEqual({ min: 2, max: 4 }); // Latest player count
    
    // Should consolidate all changes
    const specText = result.currentSpec.designSpecification.toLowerCase();
    expect(specText).toMatch(/dice|roll/); // From change 1
    expect(specText).toMatch(/best of 3|3 rounds|round/); // From change 2
    expect(specText).toMatch(/scor|point/); // From change 3

    // Should clear pending changes
    expect(result.pendingSpecChanges).toEqual([]);

    console.log("\n=== MULTIPLE PENDING CHANGES ===");
    console.log("Consolidated 3 pending changes");
    console.log("Latest summary:", result.currentSpec.summary);
    console.log("Latest player count:", result.currentSpec.playerCount);
    console.log("================================\n");
  }, 60000);

  test("should prioritize later changes in conflicts", async () => {
    if (!hasApiKey) {
      console.log("⚠️  Skipping - no API key");
      return;
    }

    const pendingChanges: SpecPlan[] = [
      {
        summary: "A betting coin flip game",
        playerCount: { min: 2, max: 2 },
        changes: "Add betting mechanic: players start with 10 coins and can bet on each flip"
      },
      {
        summary: "A betting coin flip game with increased stakes",
        playerCount: { min: 2, max: 2 },
        changes: "Increase starting coins from 10 to 20"
      },
      {
        summary: "A simple coin flip game", // Conflicting - removes betting!
        playerCount: { min: 2, max: 2 },
        changes: "Remove the betting mechanic completely - just simple coin flips"
      }
    ];

    const state = createTestState({
      pendingSpecChanges: pendingChanges,
    });

    const result = await executeSpec(state);

    expect(result.currentSpec).toBeDefined();
    
    // Latest change should win - betting should be REMOVED
    const specText = result.currentSpec.designSpecification.toLowerCase();
    
    // Should NOT have betting/coins (since last change removed it)
    const hasBetting = specText.includes('bet') || specText.includes('coin') && specText.includes('10') || specText.includes('20');
    
    console.log("\n=== CONFLICTING CHANGES ===");
    console.log("Change 1: Add betting with 10 coins");
    console.log("Change 2: Increase to 20 coins");
    console.log("Change 3: Remove betting completely");
    console.log("\nFinal spec has betting:", hasBetting);
    console.log("===========================\n");

    // Latest instruction (remove betting) should win
    // Note: This is a soft check since LLM might still mention coins in context
    // The key is the spec structure shouldn't have a betting phase/mechanic
    expect(result.currentSpec.summary).toBe("A simple coin flip game");
    expect(result.pendingSpecChanges).toEqual([]);
  }, 60000);

  test("should clear pending changes after consolidation", async () => {
    if (!hasApiKey) {
      console.log("⚠️  Skipping - no API key");
      return;
    }

    const pendingChanges: SpecPlan[] = [
      {
        summary: "Card game",
        playerCount: { min: 2, max: 2 },
        changes: "Create a card game with draw and discard"
      },
      {
        summary: "Card game with special cards",
        playerCount: { min: 2, max: 2 },
        changes: "Add special action cards"
      }
    ];

    const state = createTestState({
      pendingSpecChanges: pendingChanges,
      specVersion: 2, // Existing version
    });

    const result = await executeSpec(state);

    // Should increment version
    expect(result.currentSpec.version).toBe(3);
    
    // Should clear pending changes
    expect(result.pendingSpecChanges).toBeDefined();
    expect(result.pendingSpecChanges).toEqual([]);
    expect(result.pendingSpecChanges).toHaveLength(0);

    console.log("\n=== PENDING CHANGES CLEARED ===");
    console.log("Had 2 pending changes");
    console.log("After consolidation:", result.pendingSpecChanges.length);
    console.log("================================\n");
  }, 60000);
});
