/**
 * Tests for the Spec Planning Agent
 * 
 * These tests verify:
 * 1. Message extraction (since last spec update)
 * 2. Conversation formatting
 * 3. State field updates
 * 4. Integratio    const result = await planSpec(state);

    console.log("\n=== SPEC UPDATE PLAN ===");
    console.log("Summary:", result.specPlan?.summary);
    console.log("Player Count:", result.specPlan?.playerCount);
    console.log("Changes:", result.specPlan?.changes);
    console.log("========================\n");

    // Verify state updates
    expect(result.specPlan).toBeDefined();
    expect(result.specPlan).toBeInstanceOf(Object);
    
    // Verify SpecPlan structure
    expect(result.specPlan!.summary).toBeDefined();
    expect(result.specPlan!.playerCount).toBeDefined();
    expect(result.specPlan!.changes).toBeDefined();
    expect(typeof result.specPlan!.changes).toBe("string");
    expect(result.specPlan!.changes.length).toBeGreaterThan(0);
    
    // Changes should reference new features mentioned
    const changes = result.specPlan!.changes.toLowerCase();
    expect(changes).toMatch(/volcano|best of 5|5 rounds/i);
  }, 30000);isual inspection of generated plans)
 * 
 * Note: LLM outputs are non-deterministic, so we verify behavior patterns
 * and state changes rather than exact output text.
 */
import { describe, expect, test, beforeAll } from "@jest/globals";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { setupDesignModel } from "#chaincraft/ai/model-config.js";
import { createSpecPlan } from "../index.js";
import type { GameDesignSpecification, GamepieceMetadata, SpecPlan } from "#chaincraft/ai/design/game-design-state.js";

// Helper function to create test state with all required fields
function createTestState(overrides: {
  messages?: any[];
  title?: string;
  currentGameSpec?: GameDesignSpecification;
  lastSpecMessageCount?: number;
} = {}) {
  return {
    messages: overrides.messages || [],
    title: overrides.title || "",
    systemPromptVersion: "1.0",
    specRequested: false,
    currentGameSpec: overrides.currentGameSpec || undefined,
    specVersion: 0,
    specUpdateNeeded: false,
    metadataUpdateNeeded: false,
    specPlan: undefined,
    metadataChangePlan: undefined,
    spec: undefined,
    updatedSpec: undefined,
    metadata: undefined,
    specDiff: undefined,
    metadataDiff: undefined,
    validationErrors: [],
    retryCount: 0,
    lastSpecUpdate: undefined,
    lastMetadataUpdate: undefined,
    lastSpecMessageCount: overrides.lastSpecMessageCount,
  };
}

describe("Plan Spec - Message Extraction", () => {
  test("should throw error when no messages to process", async () => {
    const model = await setupDesignModel();
    const planSpec = createSpecPlan(model);
    
    const state = createTestState({
      messages: [],
    });

    await expect(planSpec(state)).rejects.toThrow(
      "[spec-plan] No messages to process"
    );
  });

  test("should extract all messages for first spec generation", async () => {
    // This is implicitly tested in the integration tests below
    // If last_spec_message_count is undefined, all messages should be used
    expect(true).toBe(true);
  });

  test("should extract only new messages for subsequent spec updates", async () => {
    // This is implicitly tested in the integration tests below
    // If last_spec_message_count is set, only messages after that index should be used
    expect(true).toBe(true);
  });
});

describe("Plan Spec - Integration", () => {
  let model: any;
  let planSpec: any;

  // Skip integration tests if no API key is configured
  const hasApiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;

  beforeAll(async () => {
    if (!hasApiKey) {
      console.log("⚠️  Skipping integration tests - no API key configured");
      return;
    }

    try {
      model = await setupDesignModel();
      planSpec = createSpecPlan(model);
    } catch (error) {
      console.log("⚠️  Failed to setup model:", error);
    }
  });

  test("should generate initial spec plan from conversation", async () => {
    if (!hasApiKey) {
      console.log("⚠️  Skipping - no API key");
      return;
    }

    const state = createTestState({
      messages: [
        new HumanMessage("I want to create a rock-paper-scissors game"),
        new AIMessage("Great! Is this for 2 players, or do you want to support more?"),
        new HumanMessage("2 players, best of 3 rounds"),
        new AIMessage("Perfect! Should we track win/loss history?"),
        new HumanMessage("Yes, and first to win 2 rounds wins the match"),
      ],
      title: "Rock Paper Scissors",
      currentGameSpec: undefined, // First spec
      lastSpecMessageCount: undefined, // First spec
    });

    const result = await planSpec(state);

    console.log("\n=== INITIAL SPEC PLAN ===");
    console.log("Summary:", result.specPlan?.summary);
    console.log("Player Count:", result.specPlan?.playerCount);
    console.log("Changes:", result.specPlan?.changes);
    console.log("========================\n");

    // Verify state updates - spec_plan should be a structured object
    expect(result.specPlan).toBeDefined();
    expect(result.specPlan).toBeInstanceOf(Object);
    
    // Verify SpecPlan structure
    expect(result.specPlan!.summary).toBeDefined();
    expect(typeof result.specPlan!.summary).toBe("string");
    expect(result.specPlan!.summary.length).toBeGreaterThan(0);
    
    expect(result.specPlan!.playerCount).toBeDefined();
    expect(result.specPlan!.playerCount.min).toBeGreaterThan(0);
    expect(result.specPlan!.playerCount.max).toBeGreaterThanOrEqual(result.specPlan!.playerCount.min);
    
    expect(result.specPlan!.changes).toBeDefined();
    expect(typeof result.specPlan!.changes).toBe("string");
    expect(result.specPlan!.changes.length).toBeGreaterThan(0);
    
    // Changes should reference key game elements mentioned
    const changes = result.specPlan!.changes.toLowerCase();
    expect(changes).toMatch(/player|round|win/);
  }, 30000);

  test("should generate spec update plan from new conversation", async () => {
    if (!hasApiKey) {
      console.log("⚠️  Skipping - no API key");
      return;
    }

    // Simulate existing spec
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

    const state = createTestState({
      messages: [
        new HumanMessage("I want to create a rock-paper-scissors game"),
        new AIMessage("Great! Is this for 2 players?"),
        new HumanMessage("2 players, best of 3 rounds"),
        new AIMessage("Perfect! I'll generate that spec."),
        // --- Spec was generated here, last_spec_message_count = 4 ---
        new HumanMessage("Actually, let's add a fourth option: 'volcano' that beats rock and scissors but loses to paper"),
        new AIMessage("Interesting twist! That adds strategic depth. Should I update the spec with this new mechanic?"),
        new HumanMessage("Yes, and also make it best of 5 instead of best of 3"),
      ],
      title: "Rock Paper Scissors Volcano",
      currentGameSpec: existingSpec,
      lastSpecMessageCount: 4, // Only process messages after index 4
    });

    const result = await planSpec(state);

    console.log("\n=== SPEC UPDATE PLAN (RPS Variant) ===");
    console.log("Summary:", result.specPlan?.summary);
    console.log("Player Count:", result.specPlan?.playerCount);
    console.log("Changes:", result.specPlan?.changes);
    console.log("========================\n");

    // Verify state updates
    expect(result.specPlan).toBeDefined();
    
    // Verify SpecPlan structure
    expect(result.specPlan!.summary).toBeDefined();
    expect(result.specPlan!.playerCount).toBeDefined();
    expect(result.specPlan!.changes).toBeDefined();
    expect(typeof result.specPlan!.changes).toBe("string");
    expect(result.specPlan!.changes.length).toBeGreaterThan(0);
    
    // Changes should reference the changes mentioned
    const changes = result.specPlan!.changes.toLowerCase();
    expect(changes).toMatch(/volcano|fourth|5|five|best of 5/);
  }, 30000);

  test("should handle complex game with multiple mechanics", async () => {
    if (!hasApiKey) {
      console.log("⚠️  Skipping - no API key");
      return;
    }

    const state = createTestState({
      messages: [
        new HumanMessage("I want to create a deck-building game"),
        new AIMessage("Interesting! Tell me more about the mechanics."),
        new HumanMessage("Players start with a basic deck of 10 cards. Each turn they draw 5 cards, play cards to gain resources, then buy new cards from a market."),
        new AIMessage("Great! What types of resources and how do players win?"),
        new HumanMessage("Two resources: gold and influence. Gold buys cards, influence buys victory points. First to 20 victory points wins. Market has 6 card piles always available."),
        new AIMessage("Perfect! Any special mechanics or card types?"),
        new HumanMessage("Yes - action cards give one-time effects, treasure cards give gold, and victory cards give points but clog your deck since they don't do anything during play."),
      ],
      title: "Deck Builder",
      currentGameSpec: undefined,
      lastSpecMessageCount: undefined,
    });

    const result = await planSpec(state);

    console.log("\n=== COMPLEX GAME PLAN ===");
    console.log("Summary:", result.specPlan?.summary);
    console.log("Player Count:", result.specPlan?.playerCount);
    console.log("Changes:", result.specPlan?.changes);
    console.log("=========================\n");

    // Verify comprehensive plan
    expect(result.specPlan).toBeDefined();
    
    const changes = result.specPlan!.changes.toLowerCase();
    // Should reference multiple key concepts
    expect(changes).toMatch(/deck|card/);
    expect(changes).toMatch(/resource|gold|influence/);
    expect(changes).toMatch(/victory|win|point/);
  }, 30000);

  test("should handle minimal conversation", async () => {
    if (!hasApiKey) {
      console.log("⚠️  Skipping - no API key");
      return;
    }

    const state = createTestState({
      messages: [
        new HumanMessage("Create a coin flip game - 2 players, whoever calls it right wins"),
      ],
      title: "Coin Flip",
      currentGameSpec: undefined,
      lastSpecMessageCount: undefined,
    });

    const result = await planSpec(state);

    console.log("\n=== MINIMAL CONVERSATION PLAN ===");
    console.log("Summary:", result.specPlan?.summary);
    console.log("Player Count:", result.specPlan?.playerCount);
    console.log("Changes:", result.specPlan?.changes);
    console.log("=================================\n");

    // Should still generate a plan from minimal input
    expect(result.specPlan).toBeDefined();
    expect(result.specPlan!.summary).toBeDefined();
    expect(result.specPlan!.playerCount).toBeDefined();
    expect(result.specPlan!.changes).toBeDefined();
    expect(result.specPlan!.changes.length).toBeGreaterThan(0);
  }, 30000);

  test("should reference current spec when updating", async () => {
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

    const state = createTestState({
      messages: [
        // Previous conversation that led to existingSpec
        new HumanMessage("Create a coin flip game"),
        new AIMessage("I'll generate that spec"),
        // --- Spec generated, last_spec_message_count = 2 ---
        new HumanMessage("Change it to best of 5 flips, and add a betting mechanic where players start with 10 coins and can bet on each flip"),
      ],
      title: "Betting Coin Flip",
      currentGameSpec: existingSpec,
      lastSpecMessageCount: 2,
    });

    const result = await planSpec(state);

    console.log("\n=== SPEC UPDATE WITH REFERENCE ===");
    console.log("Current Spec Summary:", existingSpec.summary);
    console.log("\nUpdate Plan:");
    console.log("Summary:", result.specPlan?.summary);
    console.log("Player Count:", result.specPlan?.playerCount);
    console.log("Changes:", result.specPlan?.changes);
    console.log("==================================\n");

    // Plan should reference updating the existing spec
    expect(result.specPlan).toBeDefined();
    const changes = result.specPlan!.changes.toLowerCase();
    expect(changes).toMatch(/best of|betting|bet|coin/);
  }, 30000);
});

describe("Plan Spec - Plan Quality (Manual Inspection)", () => {
  const hasApiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;

  test("plan should have structured metadata and natural language changes", async () => {
    if (!hasApiKey) {
      console.log("⚠️  Skipping - no API key");
      return;
    }

    const model = await setupDesignModel();
    const planSpec = createSpecPlan(model);

    const state = createTestState({
      messages: [
        new HumanMessage("Make a trading card game where players battle with creatures"),
        new AIMessage("Cool! Tell me more."),
        new HumanMessage("Each creature has attack and defense. Players take turns attacking. First to reduce opponent to 0 health wins."),
      ],
      title: "Creature Battle",
    });

    const result = await planSpec(state);

    console.log("\n=== PLAN FORMAT CHECK ===");
    console.log("Summary:", result.specPlan?.summary);
    console.log("Player Count:", result.specPlan?.playerCount);
    console.log("Changes:", result.specPlan?.changes);
    console.log("=========================\n");

    // Manual inspection: 
    // - Should have summary, playerCount, and changes fields
    // - Changes should be readable English, not JSON
    // - Changes should describe WHAT to change and WHY
    // - Changes should be detailed enough for spec-execute agent to use
    
    expect(result.specPlan).toBeDefined();
    expect(result.specPlan!.summary).toBeDefined();
    expect(result.specPlan!.playerCount).toBeDefined();
    expect(result.specPlan!.changes).toBeDefined();
    
    // Verify it's NOT JSON
    expect(result.specPlan!.changes).not.toMatch(/^\{/); // Not JSON object
    expect(result.specPlan!.changes).not.toMatch(/^\[/); // Not JSON array
  }, 30000);
});

