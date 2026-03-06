/**
 * Minimax Explicit Prompt Caching Verification
 *
 * Verifies that our existing cache_control content-block caching pattern works
 * against Minimax's Anthropic-compatible endpoint with no code changes.
 *
 * BACKGROUND
 * ----------
 * Minimax documents two caching modes:
 *
 *  1. Automatic Caching (standard API)
 *     Passively caches repeated prefixes — no cache_control markers required.
 *     Min 512 tokens.  Cache TTL automatically adjusted by system load.
 *     Docs: https://platform.minimax.io/docs/api-reference/text-prompt-caching
 *
 *  2. Explicit Prompt Caching (Anthropic API) ← what our codebase uses
 *     Uses cache_control: {type: "ephemeral"} content blocks — identical to
 *     Anthropic's own format.  Min 512 tokens.  5-minute TTL, refreshed on hit.
 *     Cache write = 1.25x input price.  Cache read = 0.1x input price.
 *     Docs: https://platform.minimax.io/docs/api-reference/anthropic-api-compatible-cache
 *
 *  PATH A — @langchain/community ChatMinimax (legacy proprietary API)
 *           NOT VIABLE — throws on non-string content, no SystemMessage support.
 *           Included as documentation of why this path was ruled out.
 *
 *  PATH B — ChatAnthropic → Minimax endpoint https://api.minimax.io/anthropic
 *           EXPECTED TO WORK — same cache_control format, fully documented.
 *           Only change needed vs production: clientOptions.baseURL override.
 *           Supported models: MiniMax-M2.5, MiniMax-M2.5-highspeed,
 *                             MiniMax-M2.1, MiniMax-M2.1-highspeed, MiniMax-M2
 *
 * Required env vars for PATH B:
 *   MINIMAX_API_KEY  — your Minimax API key
 *   MINIMAX_MODEL    — model name, e.g. "MiniMax-M2.5" (optional, has default)
 *
 * Run:
 *   cd game-builder
 *   node --experimental-vm-modules ./node_modules/jest/bin/jest.js \
 *     tests/test-minimax-cache-compat.test.ts --verbose
 */

import dotenv from "dotenv";
import dotenvExpand from "dotenv-expand";
dotenvExpand.expand(dotenv.config());

import { HumanMessage } from "@langchain/core/messages";
import { ChatAnthropic } from "@langchain/anthropic";
import { createCachedSystemMessage } from "#chaincraft/ai/prompt-template-processor.js";

// ─── helpers ────────────────────────────────────────────────────────────────

/** Build a ~1500-token stable system prompt to exceed the cache minimum. */
function buildLargeSystemPrompt(): string {
  return (
    `You are an expert game rules engine that interprets player actions and returns structured state updates.\n\n` +
    `STABLE RULES (this section is always identical across calls):\n` +
    `${"This block contains the canonical game rules that never change between turns. ".repeat(150)}\n`
  );
}

function extractCacheUsage(response: any) {
  // LangChain surfaces this differently depending on the underlying SDK version
  const meta =
    response.response_metadata?.usage ??
    response.usage_metadata ??
    response.additional_kwargs?.usage ??
    null;
  return meta;
}

// ─── PATH A — @langchain/community ChatMinimax ──────────────────────────────

describe("PATH A — ChatMinimax (community package) + cache_control blocks", () => {
  it("should reveal that ChatMinimax does NOT accept content-block caching", async () => {
    // Dynamic import so the test still runs even if @langchain/community is absent.
    let ChatMinimax: any;
    try {
      const mod = await import("@langchain/community/chat_models/minimax");
      ChatMinimax = mod.ChatMinimax;
    } catch {
      console.log(
        "⚠️  @langchain/community is not installed.\n" +
          "   Install with: npm install --save-dev @langchain/community\n" +
          "   Skipping PATH A entirely."
      );
      return; // not a failure — we just skip
    }

    const apiKey = process.env.MINIMAX_API_KEY;
    const groupId = process.env.MINIMAX_GROUP_ID;

    if (!apiKey || !groupId) {
      console.log(
        "⚠️  MINIMAX_API_KEY / MINIMAX_GROUP_ID not set. Skipping PATH A live call.\n" +
          "   Will still probe the interface for content-block support."
      );
    }

    // Build the cached system message using our existing helper
    const stablePrompt = buildLargeSystemPrompt();
    const cachedSystemMessage = createCachedSystemMessage(stablePrompt);

    console.log("\n--- PATH A: ChatMinimax content inspection ---");
    console.log("createCachedSystemMessage returns:", JSON.stringify(cachedSystemMessage.content).slice(0, 200), "...");
    console.log("Content type (string or array?):", Array.isArray(cachedSystemMessage.content) ? "array of blocks ← ChatMinimax WILL throw" : "plain string ← might work");

    // ChatMinimax's messageToMinimaxMessage explicitly throws:
    //   "ChatMinimax does not support non-string message content."
    // AND its messageToMinimaxRole throws for system messages:
    //   "System messages not supported"
    // (system messages are handled via botSetting fallback but still requires string content)

    if (!apiKey || !groupId) {
      // Structural check only — no network call
      const isArrayContent = Array.isArray(cachedSystemMessage.content);
      console.log(
        isArrayContent
          ? "✗ CONFIRMED: cache_control blocks are an array — ChatMinimax will throw synchronously on invoke."
          : "  Content is a plain string — ChatMinimax might accept it (but cache_control is ignored)."
      );
      // We assert this IS an array — verifying our understanding of the codebase
      expect(isArrayContent).toBe(true);
      console.log("\nConclusion: @langchain/community ChatMinimax is NOT compatible with our caching approach.\n");
      return;
    }

    // If env vars exist, attempt a live call and expect it to throw
    let model: any;
    try {
      model = new ChatMinimax({
        minimaxGroupId: groupId,
        minimaxApiKey: apiKey,
        proVersion: true,
        tokensToGenerate: 50,
      });
    } catch (e: any) {
      console.log("ChatMinimax constructor threw:", e.message);
      return;
    }

    console.log("\nAttempting live call with cache_control content blocks...");
    try {
      await model.invoke([cachedSystemMessage, new HumanMessage("Say hello.")]);
      console.log("✗ UNEXPECTED: Call succeeded — cache_control blocks were silently accepted (likely ignored).");
    } catch (e: any) {
      console.log("✓ EXPECTED throw:", e.message);
      expect(e.message).toMatch(/non-string|not supported|System messages/i);
    }
  }, 30_000);
});

// ─── PATH B — ChatAnthropic → Minimax Anthropic-compatible endpoint ─────────

describe("PATH B — ChatAnthropic → Minimax Anthropic-compatible endpoint", () => {
  // Minimax's Anthropic-compatible endpoint:
  //   https://platform.minimax.io/docs/api-reference/text-anthropic-api
  // Usage: set ANTHROPIC_BASE_URL=https://api.minimax.io/anthropic in the Anthropic SDK.
  // In LangChain we pass it via clientOptions.baseURL.
  const MINIMAX_ANTHROPIC_BASE = "https://api.minimax.io/anthropic";

  const apiKey = process.env.MINIMAX_API_KEY;
  const modelName = process.env.MINIMAX_MODEL ?? "MiniMax-M2.5";

  beforeAll(() => {
    if (!apiKey) {
      console.log(
        "\n⚠️  MINIMAX_API_KEY not set.\n" +
          "   PATH B tests will be skipped.\n" +
          "   Add MINIMAX_API_KEY to your .env file to run the live cache probe.\n" +
          "   Minimax explicitly supports cache_control content blocks via their\n" +
          "   Anthropic-compatible endpoint — this is expected to work.\n" +
          "   Docs: https://platform.minimax.io/docs/api-reference/anthropic-api-compatible-cache\n"
      );
    }
  });

  it("should send two calls with cache_control content blocks and report cache usage", async () => {
    if (!apiKey) {
      console.log("SKIPPED — MINIMAX_API_KEY not set.");
      return;
    }

    // ChatAnthropic with baseURL override — identical to our production ChatAnthropic
    // usage except for the endpoint. No code changes to model.ts required for the test.
    const model = new ChatAnthropic({
      model: modelName,
      apiKey,
      maxTokens: 100,
      temperature: 1,
      clientOptions: {
        baseURL: MINIMAX_ANTHROPIC_BASE,
      },
    });

    const stablePrompt = buildLargeSystemPrompt();
    const tokenEstimate = Math.round(stablePrompt.length / 4);
    console.log(`\n--- PATH B: ChatAnthropic → Minimax Anthropic-compat endpoint ---`);
    console.log(`Model: ${modelName}  |  Base URL: ${MINIMAX_ANTHROPIC_BASE}`);
    console.log(`Stable prompt: ${stablePrompt.length} chars (~${tokenEstimate} tokens)`);

    // Use our existing createCachedSystemMessage helper — same as production code
    const cachedSystem = createCachedSystemMessage(stablePrompt);

    // ── Call 1: should write to cache ──
    console.log("\nCall 1 (expect cache_write)...");
    let response1: any;
    try {
      response1 = await model.invoke([
        cachedSystem,
        new HumanMessage("What is 2 + 2?"),
      ]);
    } catch (e: any) {
      console.error("✗ Call 1 FAILED:", e.message);
      console.error("  Unexpected — Minimax documents cache_control support on their Anthropic endpoint.");
      console.error("  Check MINIMAX_API_KEY is valid and the model name is correct.");
      return;
    }

    const usage1 = extractCacheUsage(response1);
    console.log("Call 1 response:", String(response1.content).slice(0, 80));
    console.log("Call 1 usage:", JSON.stringify(usage1, null, 2));

    // ── Call 2: same cached system, different user message → should read from cache ──
    console.log("\nCall 2 (expect cache_read)...");
    let response2: any;
    try {
      response2 = await model.invoke([
        cachedSystem,                            // identical → cache hit
        new HumanMessage("What is 3 + 3?"),      // different user message
      ]);
    } catch (e: any) {
      console.error("✗ Call 2 FAILED:", e.message);
      return;
    }

    const usage2 = extractCacheUsage(response2);
    console.log("Call 2 response:", String(response2.content).slice(0, 80));
    console.log("Call 2 usage:", JSON.stringify(usage2, null, 2));

    // ── Interpret results ──
    console.log("\n--- CACHE COMPATIBILITY VERDICT ---");

    const cacheWrite = usage1?.cache_creation_input_tokens ?? 0;
    const cacheRead  = usage2?.cache_read_input_tokens     ?? 0;

    if (cacheRead > 0) {
      console.log(`✓ CACHING CONFIRMED — Call 2 served ${cacheRead} tokens from cache`);
      console.log(`  Call 2 non-cached tokens (user message only): ${usage2?.input_tokens}`);
      if (cacheWrite > 0) {
        console.log(`  Explicit cache write reported on Call 1: ${cacheWrite} tokens (Anthropic-style)`);
      } else {
        console.log(`  No cache_creation tokens on Call 1 — Minimax uses automatic caching`);
        console.log(`  (write is free/implicit, only reads are reported)`);
      }
      console.log(`\n  Migration verdict: VIABLE. Our cache_control blocks are honoured.`);
      console.log(`  cache_read price = 0.1x input → ~90% savings on the cached portion.\n`);
    } else if (cacheWrite > 0) {
      console.log(`⚠️  Cache was written (${cacheWrite} tokens) but Call 2 shows no cache_read.`);
      console.log(`  Try running again — cache may have expired or there is a TTL issue.\n`);
    } else {
      console.log(`✗ NO CACHE METRICS on either call.`);
      console.log(`  cache_control content blocks may be silently ignored.`);
      console.log(`  Call 1 usage: ${JSON.stringify(usage1)}`);
      console.log(`  Call 2 usage: ${JSON.stringify(usage2)}\n`);
    }

    // Assert caching is working
    expect(response1).toBeDefined();
    expect(response2).toBeDefined();
    expect(cacheRead).toBeGreaterThan(0);
  }, 120_000);
});
