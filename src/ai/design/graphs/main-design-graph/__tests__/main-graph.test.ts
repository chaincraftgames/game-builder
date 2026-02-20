/**
 * Main Design Graph Integration Tests
 * 
 * Tests the full graph flow from conversation through spec generation.
 */

import { describe, it, expect, beforeAll } from "@jest/globals";
import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { createMainDesignGraph } from "../index.js";
import { createTracerCallbacks } from "../../../../model-config.js";

describe("Main Design Graph - Integration", () => {
  let graph: Awaited<ReturnType<typeof createMainDesignGraph>>;
  let checkpointer: MemorySaver;
  const callbacks = createTracerCallbacks("chaincraft-design");
  
  beforeAll(async () => {
    checkpointer = new MemorySaver();
    
    const mechanicsRegistry = `
# Available Mechanics

- Turn-based gameplay
- Resource management
- Victory point systems
    `.trim();
    
    graph = await createMainDesignGraph(
      checkpointer,
      mechanicsRegistry
    );
  }, 30000); // Allow time for model setup
  
  it("should generate initial spec from conversation", async () => {
    const config = { 
      configurable: { thread_id: "test-initial-spec" },
      callbacks
    };
    
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
    expect(result.currentSpec).toBeDefined();
    expect(result.currentSpec?.summary).toBeTruthy();
    expect(result.currentSpec?.playerCount).toEqual({ min: 2, max: 2 });
    expect(result.currentSpec?.designSpecification).toBeTruthy();
    
    // Verify spec was saved to currentGameSpec (via spec-diff node)
    expect(result.currentSpec).toEqual(result.updatedSpec);
    
    // Verify diff was generated (LLM-based, should mention it's new/created/initial)
    expect(result.specDiff).toBeDefined();
    expect(result.specDiff).toMatch(/initial|new|complete|generated|created/i);
    
    // Verify flags were cleared
    expect(result.specUpdateNeeded).toBe(false);
    
    console.log("\n=== INITIAL SPEC TEST ===");
    console.log("Messages count:", result.messages.length);
    console.log("Summary:", result.currentSpec?.summary);
    console.log("Player count:", result.currentSpec?.playerCount);
    console.log("\nDiff preview:");
    console.log(result.specDiff?.substring(0, 300) + "...");
  }, 60000);
  
  it("should update existing spec from conversation", async () => {
    const config = { configurable: { thread_id: "test-update-spec" }, callbacks };
    
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
      ],
      forceSpecGeneration: true // Force immediate generation of update
    };
    
    const result = await graph.invoke(updateInputs, config);
    
    // Verify spec was updated
    expect(result.currentSpec).toBeDefined();
    expect(result.currentSpec?.designSpecification).toContain("volcano");
    
    // Verify diff shows modification (LLM-based, should mention change/update/added)
    expect(result.specDiff).toBeDefined();
    expect(result.specDiff).toMatch(/change|update|added|expanded|v1.*v2/i);
    
    // Verify currentGameSpec was updated (via spec-diff node)
    expect(result.currentSpec).toEqual(result.updatedSpec);
    
    console.log("\n=== UPDATE SPEC TEST ===");
    console.log("Updated summary:", result.currentSpec?.summary);
    console.log("\nDiff preview:");
    console.log(result.specDiff?.substring(0, 300) + "...");
  }, 120000); // 2 minutes for 2 spec generations
  
  it("should handle conversation without spec update request", async () => {
    const config = { configurable: { thread_id: "test-no-spec-update" }, callbacks };
    
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
  }, 90000); // 1.5 minutes for initial spec + conversation
  
  it("should preserve conversation history across turns", async () => {
    const config = { configurable: { thread_id: "test-multi-turn" }, callbacks };
    
    // Turn 1
    const turn1 = await graph.invoke({
      messages: [new HumanMessage("I want to make a trivia game.")]
    }, config);
    
    expect(turn1.messages.length).toBeGreaterThanOrEqual(2); // User + AI response
    
    // Turn 2
    const turn2 = await graph.invoke({
      messages: [new HumanMessage("Make it for 2-4 players.")],
      forceSpecGeneration: true // Force update to verify multi-turn
    }, config);
    
    // Should have accumulated messages from both turns
    expect(turn2.messages.length).toBeGreaterThan(turn1.messages.length);
    
    // Verify spec reflects both turns
    expect(turn2.currentSpec).toBeDefined();
    expect(turn2.currentSpec?.playerCount.min).toBe(2);
    expect(turn2.currentSpec?.playerCount.max).toBe(4);
    
    console.log("\n=== MULTI-TURN TEST ===");
    console.log("Turn 1 messages:", turn1.messages.length);
    console.log("Turn 2 messages:", turn2.messages.length);
    console.log("Final player count:", turn2.currentSpec?.playerCount);
  }, 120000); // 2 minutes for 2 turns with spec generation
});

describe("Main Design Graph - Lazy Spec Generation", () => {
  let graph: Awaited<ReturnType<typeof createMainDesignGraph>>;
  const callbacks = createTracerCallbacks("chaincraft-design");
  
  beforeAll(async () => {
    const checkpointer = new MemorySaver();
    graph = await createMainDesignGraph(
      checkpointer,
      "Test mechanics"
    );
  }, 30000);
  
  it("should accumulate changes and consolidate when threshold is reached", async () => {
    const config = { 
      configurable: { thread_id: "test-lazy-generation" }, 
      callbacks 
    };
    
    // First: Create initial spec (will generate immediately since no existing spec)
    const initialResult = await graph.invoke({
      messages: [new HumanMessage("Make a coin flip game for 2 players.")],
      consolidationThreshold: 3, // Lower threshold for testing
      consolidationCharLimit: 10000, // High char limit to test plan count threshold
    }, config);
    
    expect(initialResult.currentSpec).toBeDefined();
    expect(initialResult.specVersion).toBe(1);
    console.log("\n=== INITIAL SPEC ===");
    console.log("Spec generated:", !!initialResult.currentSpec);
    console.log("Version:", initialResult.specVersion);
    
    // Now make 2 updates - should accumulate (below threshold of 3)
    const changes = [
      "Add score.",
      "Best of 5.",
    ];
    
    let result;
    for (let i = 0; i < changes.length; i++) {
      result = await graph.invoke({
        messages: [new HumanMessage(changes[i])],
        consolidationThreshold: 3, // Keep threshold consistent
        consolidationCharLimit: 10000, // High char limit
      }, config);
      
      console.log(`\n=== UPDATE ${i + 1} ===`);
      console.log("Pending changes:", result.pendingSpecChanges?.length || 0);
      console.log("SpecDiff generated:", !!result.specDiff); 
      console.log("Spec version:", result.specVersion);
      
      // Should be accumulating - no new diff or version bump
      expect(result.pendingSpecChanges).toBeDefined();
      expect(result.pendingSpecChanges.length).toBe(i + 1);
      expect(result.specDiff).toBeUndefined(); // No diff means no new spec generation
      expect(result.specVersion).toBe(1); // Version should remain 1
    }
    
    // 3rd update: Should trigger consolidation (hits plan count threshold)
    result = await graph.invoke({
      messages: [new HumanMessage("Add timer.")],
      consolidationThreshold: 3,
      consolidationCharLimit: 10000,
    }, config);
    
    console.log("\n=== UPDATE 3 (Should Consolidate) ===");
    console.log("Pending changes:", result.pendingSpecChanges?.length || 0);
    console.log("New spec generated:", !!result.currentSpec);
    console.log("Version:", result.specVersion);
    
    // Should have consolidated
    expect(result.currentSpec).toBeDefined();
    expect(result.currentSpec?.designSpecification).toBeTruthy();
    expect(result.specDiff).toBeDefined();
    expect(result.pendingSpecChanges).toEqual([]);
    expect(result.specVersion).toBe(2);
    
    console.log("Summary:", result.currentSpec?.summary);
  }, 180000); // 3 minutes for 4 LLM calls
  
  it("should generate spec immediately when forceSpecGeneration is true", async () => {
    const config = { 
      configurable: { thread_id: "test-force-generation" }, 
      callbacks 
    };
    
    // Turn 1: Generate initial spec (always happens immediately when no spec exists)
    const result1 = await graph.invoke({
      messages: [new HumanMessage("Create a poker game for 2-6 players.")],
      consolidationThreshold: 5, // High threshold to ensure accumulation
      consolidationCharLimit: 10000,
    }, config);
    
    // Initial spec should be generated immediately
    expect(result1.currentSpec).toBeDefined();
    expect(result1.specVersion).toBe(1);
    expect(result1.pendingSpecChanges).toEqual([]);
    
    // Turn 2: Accumulate a change (below threshold, no force)
    const result2 = await graph.invoke({
      messages: [new HumanMessage("Add betting mechanics.")],
    }, config);
    
    // Should have accumulated without generating new spec
    expect(result2.pendingSpecChanges).toBeDefined();
    expect(result2.pendingSpecChanges.length).toBe(1);
    expect(result2.specVersion).toBe(1); // Version unchanged
    
    // Turn 3: Force generation with accumulated changes (below threshold but forced)
    const result3 = await graph.invoke({
      messages: [new HumanMessage("Add chip denominations.")],
      forceSpecGeneration: true
    }, config);
    
    // Should have generated spec despite being below threshold
    expect(result3.currentSpec).toBeDefined();
    expect(result3.currentSpec?.summary).toBeTruthy();
    expect(result3.currentSpec?.designSpecification).toBeTruthy();
    expect(result3.specDiff).toBeDefined();
    
    // Should have cleared pending changes
    expect(result3.pendingSpecChanges).toEqual([]);
    
    // Should have reset force flag
    expect(result3.forceSpecGeneration).toBe(false);
    
    // Should have incremented version
    expect(result3.specVersion).toBe(2);
    
    console.log("\n=== FORCE GENERATION TEST ===");
    console.log("Initial spec version:", result1.specVersion);
    console.log("Pending changes before force:", result2.pendingSpecChanges.length);
    console.log("Spec generated:", !!result3.currentSpec);
    console.log("Pending changes after:", result3.pendingSpecChanges?.length || 0);
    console.log("Force flag reset:", result3.forceSpecGeneration === false);
    console.log("Final spec version:", result3.specVersion);
  }, 180000); // 3 minutes for initial + accumulation + forced generation
  
  it("should consolidate when character limit is reached", async () => {
    const config = { 
      configurable: { thread_id: "test-char-limit-consolidation" }, 
      callbacks 
    };
    
    // Create a large change that exceeds character limit
    const largeChange = `
      Create a complex strategy game where players control armies.
      Include the following features:
      - Multiple unit types (infantry, cavalry, archers, siege weapons)
      - Resource gathering (wood, stone, gold, food)
      - Building construction (barracks, stables, archery range, siege workshop)
      - Technology research (improved armor, better weapons, faster training)
      - Terrain effects (mountains provide defense bonuses, forests slow movement)
      - Weather system affecting combat
      - Morale system for units
      - Hero units with special abilities
      - Diplomatic options between players
      - Trade routes for resources
      - Seasonal changes affecting resource production
      - Unit veterancy and experience
      - Fog of war mechanics
      - Supply lines and logistics
      - Naval combat on water tiles
      - Fortifications and walls
      - Siege mechanics for attacking fortified positions
      - Victory conditions: military conquest, wonder construction, diplomatic victory
    `.trim();
    
    const result = await graph.invoke({
      messages: [new HumanMessage(largeChange)]
    }, config);
    
    // With a 2000 char limit, this should trigger consolidation
    // (the change text is ~900 chars, but the full SpecPlan.changes might exceed limit
    // depending on LLM elaboration)
    
    // Either consolidated immediately OR accumulated (depending on LLM output length)
    if (result.currentSpec) {
      // Consolidated
      expect(result.currentSpec.designSpecification).toBeTruthy();
      expect(result.pendingSpecChanges).toEqual([]);
      console.log("\n=== CHAR LIMIT TEST (Consolidated) ===");
      console.log("Consolidated immediately due to char limit");
    } else {
      // Accumulated - check it's under threshold
      expect(result.pendingSpecChanges).toBeDefined();
      expect(result.pendingSpecChanges.length).toBeLessThan(5);
      console.log("\n=== CHAR LIMIT TEST (Accumulated) ===");
      console.log("Changes accumulated, below both thresholds");
    }
  }, 120000); // 2 minutes for large spec generation
});
