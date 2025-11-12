/**
 * Main Design Graph Integration Tests
 * 
 * Tests the full graph flow from conversation through spec generation.
 */

import { describe, it, expect, beforeAll } from "@jest/globals";
import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { createMainDesignGraph } from "../index.js";

describe("Main Design Graph - Integration", () => {
  let graph: Awaited<ReturnType<typeof createMainDesignGraph>>;
  let checkpointer: MemorySaver;
  
  beforeAll(async () => {
    checkpointer = new MemorySaver();
    
    const constraintsRegistry = `
# Game Design Constraints

- Games should be turn-based
- Clear win/loss conditions required
- Must specify player count range
    `.trim();
    
    const mechanicsRegistry = `
# Available Mechanics

- Turn-based gameplay
- Resource management
- Victory point systems
    `.trim();
    
    graph = await createMainDesignGraph(
      checkpointer,
      constraintsRegistry,
      mechanicsRegistry
    );
  }, 30000); // Allow time for model setup
  
  it("should generate initial spec from conversation", async () => {
    const config = { configurable: { thread_id: "test-initial-spec" } };
    
    const inputs = {
      messages: [
        new HumanMessage("I want to create a simple coin flip guessing game for 2 players.")
      ]
    };
    
    const result = await graph.invoke(inputs, config);
    
    // Verify conversation happened
    expect(result.messages).toBeDefined();
    expect(result.messages.length).toBeGreaterThan(1);
    
    // Verify spec was generated
    expect(result.spec).toBeDefined();
    expect(result.spec?.summary).toBeTruthy();
    expect(result.spec?.playerCount).toEqual({ min: 2, max: 2 });
    expect(result.spec?.designSpecification).toBeTruthy();
    
    // Verify spec was saved to currentGameSpec (via diff-spec node)
    expect(result.currentGameSpec).toEqual(result.updatedSpec);
    
    // Verify diff was generated
    expect(result.specDiff).toBeDefined();
    expect(result.specDiff).toContain("New Specification Created");
    
    // Verify flags were cleared
    expect(result.specUpdateNeeded).toBe(false);
    
    console.log("\n=== INITIAL SPEC TEST ===");
    console.log("Messages count:", result.messages.length);
    console.log("Summary:", result.spec?.summary);
    console.log("Player count:", result.spec?.playerCount);
    console.log("\nDiff preview:");
    console.log(result.specDiff?.substring(0, 300) + "...");
  }, 60000);
  
  it("should update existing spec from conversation", async () => {
    const config = { configurable: { thread_id: "test-update-spec" } };
    
    // First: Create initial spec
    const initialInputs = {
      messages: [
        new HumanMessage("Create a rock-paper-scissors game for 2 players.")
      ]
    };
    
    await graph.invoke(initialInputs, config);
    
    // Then: Request update
    const updateInputs = {
      messages: [
        new HumanMessage("Add a fourth option called 'volcano' that beats rock and scissors but loses to paper.")
      ]
    };
    
    const result = await graph.invoke(updateInputs, config);
    
    // Verify spec was updated
    expect(result.spec).toBeDefined();
    expect(result.spec?.designSpecification).toContain("volcano");
    
    // Verify diff shows modification
    expect(result.specDiff).toBeDefined();
    expect(result.specDiff).toContain("Updated");
    
    // Verify currentGameSpec was updated (via diff-spec node)
    expect(result.currentGameSpec).toEqual(result.updatedSpec);
    
    console.log("\n=== UPDATE SPEC TEST ===");
    console.log("Updated summary:", result.spec?.summary);
    console.log("\nDiff preview:");
    console.log(result.specDiff?.substring(0, 300) + "...");
  }, 90000);
  
  it("should handle conversation without spec update request", async () => {
    const config = { configurable: { thread_id: "test-no-spec-update" } };
    
    // First: Create initial spec
    const initialInputs = {
      messages: [
        new HumanMessage("Create a simple card game.")
      ]
    };
    
    await graph.invoke(initialInputs, config);
    
    // Then: Ask a clarifying question (no spec update needed)
    const questionInputs = {
      messages: [
        new HumanMessage("What card games are popular?")
      ]
    };
    
    const result = await graph.invoke(questionInputs, config);
    
    // Verify conversation happened but no spec generation
    expect(result.messages).toBeDefined();
    
    // The spec should remain unchanged from previous invocation
    // spec_update_needed should be false (no new spec generation triggered)
    expect(result.specUpdateNeeded).toBe(false);
    
    console.log("\n=== NO UPDATE TEST ===");
    console.log("Messages count:", result.messages.length);
    console.log("Spec update needed:", result.specUpdateNeeded);
  }, 60000);
  
  it("should preserve conversation history across turns", async () => {
    const config = { configurable: { thread_id: "test-multi-turn" } };
    
    // Turn 1
    const turn1 = await graph.invoke({
      messages: [new HumanMessage("I want to make a trivia game.")]
    }, config);
    
    expect(turn1.messages.length).toBeGreaterThanOrEqual(2); // User + AI response
    
    // Turn 2
    const turn2 = await graph.invoke({
      messages: [new HumanMessage("Make it for 2-4 players.")]
    }, config);
    
    // Should have accumulated messages from both turns
    expect(turn2.messages.length).toBeGreaterThan(turn1.messages.length);
    
    // Verify spec reflects both turns
    expect(turn2.spec).toBeDefined();
    expect(turn2.spec?.playerCount.min).toBe(2);
    expect(turn2.spec?.playerCount.max).toBe(4);
    
    console.log("\n=== MULTI-TURN TEST ===");
    console.log("Turn 1 messages:", turn1.messages.length);
    console.log("Turn 2 messages:", turn2.messages.length);
    console.log("Final player count:", turn2.spec?.playerCount);
  }, 90000);
});

describe("Main Design Graph - Node Functionality", () => {
  let graph: Awaited<ReturnType<typeof createMainDesignGraph>>;
  
  beforeAll(async () => {
    const checkpointer = new MemorySaver();
    graph = await createMainDesignGraph(
      checkpointer,
      "Test constraints",
      "Test mechanics"
    );
  }, 30000);
  
  it("should generate meaningful diffs", async () => {
    const config = { configurable: { thread_id: "test-diff-quality" } };
    
    const inputs = {
      messages: [
        new HumanMessage("Create a deck-building game where players start with 10 cards and buy new cards from a market.")
      ]
    };
    
    const result = await graph.invoke(inputs, config);
    
    // Verify diff contains key information
    expect(result.specDiff).toBeDefined();
    expect(result.specDiff).toContain("Specification");
    expect(result.specDiff).toContain("deck-building");
    
    console.log("\n=== DIFF QUALITY TEST ===");
    console.log(result.specDiff);
  }, 60000);
  
  it("should return state with diff and spec for API consumption", async () => {
    const config = { configurable: { thread_id: "test-api-response" } };
    
    const inputs = {
      messages: [
        new HumanMessage("Create a tic-tac-toe game.")
      ]
    };
    
    const result = await graph.invoke(inputs, config);
    
    // Verify state contains all necessary data for API response
    expect(result.specDiff).toBeDefined();
    expect(result.specDiff).toContain("New Specification Created");
    
    expect(result.currentGameSpec).toBeDefined();
    expect(result.currentGameSpec?.designSpecification).toBeTruthy();
    expect(result.currentGameSpec?.summary).toBeTruthy();
    
    // The final conversational message should still be from the conversation node
    const aiMessages = result.messages.filter(m => m._getType() === 'ai');
    expect(aiMessages.length).toBeGreaterThan(0);
    
    console.log("\n=== API RESPONSE TEST ===");
    console.log("Diff length:", result.specDiff?.length);
    console.log("Spec length:", result.currentGameSpec?.designSpecification.length);
    console.log("Has diff:", !!result.specDiff);
    console.log("Has spec:", !!result.currentGameSpec);
  }, 60000);
});
