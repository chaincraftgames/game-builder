/**
 * Tests for the spec-in-progress concurrency guard.
 *
 * Verifies that:
 * 1. When a spec generation is already in progress, auto-consolidation
 *    routes to END (changes stay pending).
 * 2. When a spec generation is already in progress, force-spec-generation
 *    routes to END rather than running a second spec-execute.
 * 3. After the guard is cleared, spec generation works normally again.
 */

import { describe, it, expect, beforeAll, afterEach } from "@jest/globals";
import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { createMainDesignGraph } from "../index.js";
import { createTracerCallbacks } from "../../../../model-config.js";
import {
  setSpecInProgress,
  clearSpecInProgress,
  isSpecInProgress,
} from "#chaincraft/events/game-creation-status-bus.js";

describe("Spec-in-progress guard", () => {
  let graph: Awaited<ReturnType<typeof createMainDesignGraph>>;
  const callbacks = createTracerCallbacks("chaincraft-design");
  const threadId = "test-spec-guard";

  beforeAll(async () => {
    const checkpointer = new MemorySaver();
    graph = await createMainDesignGraph(checkpointer);
  }, 30000);

  afterEach(() => {
    // Always clean up the guard so tests are independent
    clearSpecInProgress(threadId);
  });

  it("should generate initial spec, then block auto-consolidation and force-gen while in progress", async () => {
    const config = { configurable: { thread_id: threadId }, callbacks };

    // ─── Turn 1: Seed conversation so spec-plan has material ─────
    console.log("\n=== TURN 1: Seed conversation ===");
    const result0 = await graph.invoke(
      {
        messages: [new HumanMessage("Create a simple card game for 2 players where you draw cards and highest wins.")],
        consolidationThreshold: 5, // High threshold — prevent auto-consolidation
        consolidationCharLimit: 50000,
      },
      config,
    );
    console.log("✓ Conversation seeded, pendingSpecChanges:", result0.pendingSpecChanges?.length || 0);

    // ─── Turn 2: Force initial spec generation ───────────────────
    console.log("\n=== TURN 2: Force initial spec ===");
    const result1 = await graph.invoke(
      {
        messages: [new HumanMessage("")],
        forceSpecGeneration: true,
      },
      config,
    );

    expect(result1.currentSpec).toBeDefined();
    expect(result1.specVersion).toBe(1);
    console.log("✓ Initial spec v1 generated");

    // ─── Turn 3: Accumulate one change (below threshold of 2) ───
    console.log("\n=== TURN 3: Accumulate 1 change ===");
    const result2 = await graph.invoke(
      {
        messages: [new HumanMessage("Add a scoring system where each round win gives 1 point.")],
        consolidationThreshold: 2, // Now lower threshold — 2 plans trigger auto-consolidation
        consolidationCharLimit: 50000,
      },
      config,
    );

    expect(result2.pendingSpecChanges.length).toBe(1);
    expect(result2.specVersion).toBe(1); // No new spec yet
    console.log("✓ 1 pending change accumulated, still v1");

    // ─── Simulate spec-in-progress ───────────────────────────────
    setSpecInProgress(threadId);
    expect(isSpecInProgress(threadId)).toBe(true);
    console.log("\n⚙ Simulated spec-in-progress flag set");

    // ─── Turn 4: Second change would hit threshold (2) but guard blocks ─
    console.log("\n=== TURN 4: Second change (threshold met, but guard blocks) ===");
    const result3 = await graph.invoke(
      {
        messages: [new HumanMessage("Add a best-of-3 rounds format to determine the winner.")],
        consolidationThreshold: 2,
        consolidationCharLimit: 50000,
      },
      config,
    );

    // Guard should have prevented spec execution — version stays at 1
    expect(result3.specVersion).toBe(1);
    expect(result3.specDiff).toBeUndefined();
    console.log(`✓ Auto-consolidation blocked (${result3.pendingSpecChanges.length} pending, still v1)`);

    // ─── Turn 5: Force gen should also be blocked ────────────────
    console.log("\n=== TURN 5: Force spec gen (guard blocks) ===");
    const result4 = await graph.invoke(
      {
        messages: [new HumanMessage("")],
        forceSpecGeneration: true,
      },
      config,
    );

    expect(result4.specVersion).toBe(1);
    // Pending changes should still be there
    expect(result4.pendingSpecChanges.length).toBeGreaterThanOrEqual(1);
    console.log(`✓ Force generation blocked (${result4.pendingSpecChanges.length} pending, still v1)`);

    // ─── Clear guard ──────────────────────────────────────────────
    clearSpecInProgress(threadId);
    expect(isSpecInProgress(threadId)).toBe(false);
    console.log("\n⚙ Guard cleared");

    // ─── Turn 6: Force gen should now succeed ─────────────────────
    console.log("\n=== TURN 6: Force spec gen (guard clear — should succeed) ===");
    const result5 = await graph.invoke(
      {
        messages: [new HumanMessage("")],
        forceSpecGeneration: true,
      },
      config,
    );

    expect(result5.currentSpec).toBeDefined();
    expect(result5.specVersion).toBe(2);
    expect(result5.pendingSpecChanges).toEqual([]);
    expect(result5.specDiff).toBeDefined();
    console.log("✓ Spec v2 generated after guard cleared");

    console.log("\n✅ All spec-in-progress guard checks passed!");
  }, 300000); // 5 minutes — multiple LLM calls
});
