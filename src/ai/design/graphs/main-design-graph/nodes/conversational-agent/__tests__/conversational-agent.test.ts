/**
 * Tests for the Conversational Design Agent
 * 
 * These tests verify:
 * 1. Tag extraction and parsing
 * 2. Flag setting based on user input
 * 3. Message handling and state updates
 * 4. Integration with model
 */
import { describe, expect, test, beforeAll } from "@jest/globals";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { setupConversationalAgentModel, setupDesignModel } from "#chaincraft/ai/model-config.js";
import { 
  createConversationalAgent,
  extractGameTitle,
  hasTag,
  stripInternalTags
} from "../index.js";
import { 
  SPEC_UPDATE_TAG, 
  METADATA_UPDATE_TAG, 
  GAME_TITLE_TAG,
  formatFewShotExamples 
} from "../prompts.js";
import type { GameDesignSpecification, GamepieceMetadata } from "#chaincraft/ai/design/game-design-state.js";

// Helper function to create test state with all required fields
function createTestState(overrides: {
  messages?: any[];
  title?: string;
  specUpdateNeeded?: boolean;
  metadataUpdateNeeded?: boolean;
  currentGameSpec?: GameDesignSpecification;
  spec?: GameDesignSpecification;
  metadata?: GamepieceMetadata;
} = {}) {
  return {
    messages: overrides.messages || [],
    title: overrides.title || "",
    systemPromptVersion: "1.0",
    currentSpec: overrides.currentGameSpec || undefined,
    specVersion: 0,
    specUpdateNeeded: overrides.specUpdateNeeded ?? false,
    metadataUpdateNeeded: overrides.metadataUpdateNeeded ?? false,
    specPlan: undefined,
    metadataPlan: undefined,
    metadataChangePlan: undefined,
    updatedSpec: undefined,
    metadata: overrides.metadata || undefined,
    specDiff: undefined,
    metadataDiff: undefined,
    validationErrors: [],
    retryCount: 0,
    lastSpecUpdate: undefined,
    lastMetadataUpdate: undefined,
    lastSpecMessageCount: undefined,
    pendingSpecChanges: [],
    forceSpecGeneration: false,
    consolidationThreshold: 5,
    consolidationCharLimit: 2000,
    narrativeStyleGuidance: undefined,
    specNarratives: undefined,
    narrativesNeedingUpdate: [],
  };
}

// Mock registries for testing - moderate size to test cache thresholds
const MOCK_MECHANICS_REGISTRY = `
- Deck Building: Players construct and modify decks during gameplay
- Area Control: Players compete for control of board spaces and territories
- Resource Management: Players collect, spend, and optimize resources
- Drafting: Players select cards or items from a shared pool in turn order
`;

const MOCK_CONSTRAINTS_REGISTRY = `
NOT SUPPORTED:
- Real-time action games requiring simultaneous play
- Games requiring precise timing or dexterity

SUPPORTED WITH LIMITATIONS:
- Complex card interactions (may require manual clarification)
- Large board sizes (performance may vary)
`;

describe("Conversational Agent - Tag Parsing", () => {
  test("should extract game title from tags", () => {
    const response = "Here's my response\n\n<game_title>Epic Adventure</game_title>\n\nMore text";
    const title = extractGameTitle(response);
    
    expect(title).toBe("Epic Adventure");
  });

  test("should handle missing game title gracefully", () => {
    const response = "Response without a title tag";
    const title = extractGameTitle(response);
    
    expect(title).toBeUndefined();
  });

  test("should detect spec update tag", () => {
    const response = "I'll update the spec\n\n<spec_update_needed>";
    const hasSpecTag = hasTag(response, SPEC_UPDATE_TAG);
    
    expect(hasSpecTag).toBe(true);
  });

  test("should detect metadata update tag", () => {
    const response = "I'll extract the metadata\n\n<metadata_update_needed>";
    const hasMetadataTag = hasTag(response, METADATA_UPDATE_TAG);
    
    expect(hasMetadataTag).toBe(true);
  });

  test("should detect both tags", () => {
    const response = "Updating both\n\n<spec_update_needed>\n<metadata_update_needed>";
    
    expect(hasTag(response, SPEC_UPDATE_TAG)).toBe(true);
    expect(hasTag(response, METADATA_UPDATE_TAG)).toBe(true);
  });

  test("should strip internal tags from user message", () => {
    const response = `Great idea! I'll update the spec.

<game_title>Medieval Builder</game_title>
<spec_update_needed>

What mechanics do you want?`;
    
    const cleaned = stripInternalTags(response);
    
    expect(cleaned).not.toContain("<game_title>");
    expect(cleaned).not.toContain("</game_title>");
    expect(cleaned).not.toContain("<spec_update_needed>");
    expect(cleaned).toContain("Great idea!");
    expect(cleaned).toContain("What mechanics do you want?");
  });
});

describe("Conversational Agent - Prompt Formatting", () => {
  test("should format few-shot examples correctly", () => {
    const formatted = formatFewShotExamples();
    
    expect(formatted).toContain("Example 1");
    expect(formatted).toContain("Example 2");
    expect(formatted).toContain("capture it immediately");
    expect(formatted).toContain("Tags to include:");
  });

  test("few-shot examples should include all required scenarios", () => {
    const formatted = formatFewShotExamples();
    
    // Should have examples for all scenarios
    expect(formatted).toContain("No update tags needed"); // No flags
    expect(formatted).toContain(SPEC_UPDATE_TAG); // Spec only
    expect(formatted).toContain(METADATA_UPDATE_TAG); // Metadata only
  });
});

describe("Conversational Agent - Integration", () => {
  let model: any;
  let agent: any;

  beforeAll(async () => {
    try {
      model = await setupConversationalAgentModel();
      
      // Create agent instance
      agent = await createConversationalAgent(
        model,
        MOCK_CONSTRAINTS_REGISTRY,
        MOCK_MECHANICS_REGISTRY
      );
    } catch (error) {
      console.log("⚠️  Failed to setup model:", error);
      // Don't fail the test suite, just skip the tests
    }
  });

  test("should handle initial game idea", async () => {
    const state = createTestState({
      messages: [
        new HumanMessage("I want to create a deck-building game about space exploration")
      ],
      specUpdateNeeded: false,
      metadataUpdateNeeded: false,
    });

    const result = await agent(state);

    // Should ask clarifying questions without setting flags
    expect(result.messages).toBeDefined();
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages[0]).toBeInstanceOf(AIMessage);
    expect(result.title).toBeDefined();
    
    // Initial conversation typically doesn't need updates yet
    // (though agent might decide to set flags - that's okay)
    const content = typeof result.messages[0].content === 'string' ? result.messages[0].content : JSON.stringify(result.messages[0].content);
    console.log("Response:", content);
    console.log("Spec update needed:", result.specUpdateNeeded);
    console.log("Metadata update needed:", result.metadataUpdateNeeded);
  }, 30000); // 30 second timeout

  test("should set spec flag when rules are defined", async () => {
    const state = createTestState({
      messages: [
        new HumanMessage("I want a card game"),
        new AIMessage("Great! What kind of gameplay?"),
        new HumanMessage("Players start with 5 cards, draw 1 per turn, and play cards to gain resources"),
        new AIMessage("Interesting! A few clarifying questions: 1) What kind of resources? 2) How do players win? 3) Is there a hand size limit?"),
        new HumanMessage("Resources are gold coins. First to 10 wins. Hand size limit is 7 cards. Players can play one card per turn to gain resources based on the card's value."),
      ],
      title: "Card Game",
      specUpdateNeeded: false,
      metadataUpdateNeeded: false,
    });

    const result = await agent(state);

    const content = typeof result.messages[0].content === 'string' ? result.messages[0].content : JSON.stringify(result.messages[0].content);
    console.log("Response:", content);
    console.log("Spec update needed:", result.specUpdateNeeded);
    
    // After a full Q&A exchange with clear rules, should update spec
    expect(result.specUpdateNeeded).toBe(true);
  }, 30000);

  test("should set metadata flag when components are described", async () => {
    const state = createTestState({
      messages: [
        new HumanMessage("I want a game"),
        new AIMessage("Tell me more!"),
        new HumanMessage("Players use standard 6-sided dice and wooden tokens in 3 colors: red, blue, and green")
      ],
      title: "Dice Game",
      specUpdateNeeded: false,
      metadataUpdateNeeded: false,
    });

    const result = await agent(state);

    const content = typeof result.messages[0].content === 'string' ? result.messages[0].content : JSON.stringify(result.messages[0].content);
    console.log("Response:", content);
    console.log("Metadata update needed:", result.metadataUpdateNeeded);
    
    // Should recognize game components and set metadata flag
    expect(result.metadataUpdateNeeded).toBe(true);
  }, 30000);

  test("should set both flags when appropriate", async () => {
    const state = createTestState({
      messages: [
        new HumanMessage("I want to make a card battle game"),
        new AIMessage("Cool! Tell me about the cards and how battles work."),
        new HumanMessage("The game uses a 52-card deck where each card has attack and defense values. Players draw 3 cards per turn and play one card to attack their opponent."),
        new AIMessage("Great start! How do players win? And what happens when a card is played - does the opponent defend?"),
        new HumanMessage("First player to reduce opponent to 0 health wins. When you attack, opponent can play a defense card from their hand. Let's also add a bounty system with 9 bounty cards that players can claim for bonus points."),
      ],
      title: "Combat Card Game",
      specUpdateNeeded: false,
      metadataUpdateNeeded: false,
    });

    const result = await agent(state);

    const content = typeof result.messages[0].content === 'string' ? result.messages[0].content : JSON.stringify(result.messages[0].content);
    console.log("Response:", content);
    console.log("Spec update needed:", result.specUpdateNeeded);
    console.log("Metadata update needed:", result.metadataUpdateNeeded);
    
    // User added new rule (win condition) AND new component (bounty cards), should set both flags
    expect(result.specUpdateNeeded).toBe(true);
    expect(result.metadataUpdateNeeded).toBe(true);
  }, 30000);

  test("should handle explicit spec request", async () => {
    const state = createTestState({
      messages: [
        new HumanMessage("I want to make a trading game"),
        new AIMessage("Interesting! Medieval or modern setting?"),
        new HumanMessage("Medieval. Players trade goods between cities."),
        new AIMessage("Nice! Any special mechanics?"),
        new HumanMessage("Players can only carry 3 goods at a time. Prices change based on supply and demand."),
        new AIMessage("Great! That gives us scarcity and economic simulation. Anything else?"),
        new HumanMessage("No, that's good. Please generate the full game specification now.")
      ],
      title: "Medieval Trading Game",
      specUpdateNeeded: false,
      metadataUpdateNeeded: false,
    });

    const result = await agent(state);

    const content = typeof result.messages[0].content === 'string' ? result.messages[0].content : JSON.stringify(result.messages[0].content);
    console.log("Response:", content);
    
    // Should set spec flag for explicit request after conversation
    expect(result.specUpdateNeeded).toBe(true);
  }, 30000);

  test("should preserve conversation history", async () => {
    const state = createTestState({
      messages: [
        new HumanMessage("I want to make a game about trading"),
        new AIMessage("Interesting! What kind of trading?"),
        new HumanMessage("Medieval merchant trading")
      ],
      title: "Trading Game",
      specUpdateNeeded: false,
      metadataUpdateNeeded: false,
    });

    const result = await agent(state);

    // Agent should see full conversation context
    expect(result.messages).toBeDefined();
    expect(result.messages[0]).toBeInstanceOf(AIMessage);
    
    console.log("Response with context:", result.messages[0].content);
  }, 30000);
});

describe("Conversational Agent - Edge Cases", () => {
  test("should handle constraint violations", async () => {
    const model = await setupDesignModel();
    const agent = await createConversationalAgent(
      model,
      MOCK_CONSTRAINTS_REGISTRY,
      MOCK_MECHANICS_REGISTRY
    );

    const state = createTestState({
      messages: [
        new HumanMessage("I want to create a real-time action game with precise timing mechanics")
      ],
      specUpdateNeeded: false,
      metadataUpdateNeeded: false,
    });

    const result = await agent(state);

    console.log("Constraint response:", result.messages[0].content);
    
    // Should inform user about constraints
    // (The exact behavior depends on the LLM, but it should respond)
    expect(result.messages[0].content).toBeDefined();
  }, 30000);

  test("should disambiguate narrative section requests", async () => {
    const model = await setupDesignModel();
    const agent = await createConversationalAgent(
      model,
      MOCK_CONSTRAINTS_REGISTRY,
      MOCK_MECHANICS_REGISTRY
    );

    const existingSpec: GameDesignSpecification = {
      summary: "A survival horror game",
      playerCount: { min: 1, max: 4 },
      designSpecification: `# Haunted Mansion

## Game Structure
8 sequential turns through haunted rooms.

## Narrative Guidance

### Tone and Style
<!-- NARRATIVE:TONE_STYLE -->

### Turn 1 Content
<!-- NARRATIVE:TURN_1_GUIDE -->

### Turn 2 Content
<!-- NARRATIVE:TURN_2_GUIDE -->

## Victory
Reach turn 8 alive.`,
      version: 1,
    };

    const state = createTestState({
      messages: [
        new HumanMessage("Make the first room less scary and more mysterious")
      ],
      currentGameSpec: existingSpec,
      specUpdateNeeded: false,
    });

    const result = await agent(state);

    console.log("\\n=== NARRATIVE DISAMBIGUATION TEST ===");
    console.log("User request: Make the first room less scary");
    console.log("Available markers: TONE_STYLE, TURN_1_GUIDE, TURN_2_GUIDE");
    console.log("\\nAgent response:");
    console.log(result.messages[0].content);
    console.log("=====================================\\n");

    // Should respond (asking for clarification or confirming which section)
    expect(result.messages[0].content).toBeDefined();
    const content = typeof result.messages[0].content === 'string' ? result.messages[0].content : JSON.stringify(result.messages[0].content);
    const response = content.toLowerCase();
    
    // Should either:
    // 1. Ask which narrative section (TURN_1_GUIDE), or
    // 2. Confirm it's updating TURN_1_GUIDE
    // The response should reference the available markers or ask for clarification
    const mentionsNarrative = response.includes('turn_1') || 
                             response.includes('turn 1') ||
                             response.includes('which') ||
                             response.includes('section');
    
    expect(mentionsNarrative).toBe(true);
  }, 30000);
});

