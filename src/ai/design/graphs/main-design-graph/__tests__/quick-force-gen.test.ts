/**
 * Quick test for pending changes and force generation
 */

import { describe, it, expect, beforeAll } from "@jest/globals";
import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { createMainDesignGraph } from "../index.js";
import { createTracerCallbacks } from "../../../../model-config.js";

describe("Quick Force Generation Test", () => {
  let graph: Awaited<ReturnType<typeof createMainDesignGraph>>;
  const callbacks = createTracerCallbacks("chaincraft-design");
  
  beforeAll(async () => {
    const checkpointer = new MemorySaver();
    graph = await createMainDesignGraph(
      checkpointer,
      "Test constraints",
      "Test mechanics"
    );
  }, 30000);
  
  it("should accumulate changes and force generate", async () => {
    const config = { 
      configurable: { thread_id: "quick-force-test" }, 
      callbacks 
    };
    
    console.log("\n=== TURN 1: Initial Spec ===");
    const result1 = await graph.invoke({
      messages: [new HumanMessage("Create a simple dice game for 2 players.")],
      consolidationThreshold: 5,
      consolidationCharLimit: 10000,
    }, config);
    
    console.log("Initial spec generated:", !!result1.currentSpec);
    console.log("Version:", result1.specVersion);
    console.log("Pending changes:", result1.pendingSpecChanges?.length || 0);
    
    expect(result1.currentSpec).toBeDefined();
    expect(result1.specVersion).toBe(1);
    expect(result1.pendingSpecChanges).toEqual([]);
    
    console.log("\n=== TURN 2: Accumulate Change ===");
    const result2 = await graph.invoke({
      messages: [new HumanMessage("Add scoring system.")],
    }, config);
    
    console.log("Spec updated:", !!result2.specDiff);
    console.log("Version:", result2.specVersion);
    console.log("Pending changes:", result2.pendingSpecChanges?.length || 0);
    
    expect(result2.pendingSpecChanges).toBeDefined();
    expect(result2.pendingSpecChanges.length).toBe(1);
    expect(result2.specVersion).toBe(1); // Should not increment
    
    console.log("\n=== TURN 3: Force Generate ===");
    const result3 = await graph.invoke({
      messages: [new HumanMessage("Add timer.")],
      forceSpecGeneration: true
    }, config);
    
    console.log("Spec generated:", !!result3.currentSpec);
    console.log("Version:", result3.specVersion);
    console.log("Pending changes:", result3.pendingSpecChanges?.length || 0);
    console.log("Force flag reset:", result3.forceSpecGeneration === false);
    
    expect(result3.currentSpec).toBeDefined();
    expect(result3.pendingSpecChanges).toEqual([]);
    expect(result3.forceSpecGeneration).toBe(false);
    expect(result3.specVersion).toBe(2); // Should increment
    
    console.log("\n✅ All checks passed!");
  }, 180000); // 3 minutes
});
