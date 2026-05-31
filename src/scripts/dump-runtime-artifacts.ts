#!/usr/bin/env node
/**
 * dump-runtime-artifacts.ts
 *
 * Reads the latest runtime checkpoint for a session and dumps
 * all artifact fields (schema, transitions, instructions, mechanics)
 * to individual files under data/exports/<sessionId>/.
 *
 * Usage:
 *   npm run dump-artifacts -- --sessionId <sessionId> [--specKey <gameId-vN>]
 *
 * If --specKey is provided, also dumps the spec-processing artifacts
 * for comparison.
 */
import { parseArgs } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import { getSaver } from "#chaincraft/ai/memory/checkpoint-memory.js";

const { values } = parseArgs({
  options: {
    sessionId: { type: "string", short: "s" },
    specKey: { type: "string", short: "k" },
  },
});

if (!values.sessionId) {
  console.error("Usage: npm run dump-artifacts -- --sessionId <sessionId> [--specKey <gameId-vN>]");
  process.exit(1);
}

const sessionId = values.sessionId;
const specKey = values.specKey;

async function dumpCheckpoint(threadId: string, graphType: string, outDir: string) {
  const saver = await getSaver(threadId, graphType);
  const config = { configurable: { thread_id: threadId } };

  // Get latest checkpoint
  const iterator = saver.list(config, { limit: 1 });
  const first = await iterator.next();

  if (first.done) {
    console.error(`No checkpoint found for thread_id=${threadId} in ${graphType}`);
    return;
  }

  const cv = first.value.checkpoint.channel_values as Record<string, unknown>;
  await fs.mkdir(outDir, { recursive: true });

  // Dump each artifact field
  const artifactKeys = [
    "gameRules",
    "stateSchema",
    "stateTransitions",
    "playerPhaseInstructions",
    "transitionInstructions",
    "generatedMechanics",
    "producedTokensConfiguration",
    "specNarratives",
    "repairHistory",
    "artifactSnapshot",
  ];

  const summary: Record<string, string> = {};

  for (const key of artifactKeys) {
    const val = cv[key];
    if (val === undefined || val === null) {
      summary[key] = "(not present)";
      continue;
    }

    let content: string;
    if (typeof val === "string") {
      // Try to pretty-print JSON strings
      try {
        const parsed = JSON.parse(val);
        content = JSON.stringify(parsed, null, 2);
      } catch {
        content = val;
      }
    } else if (typeof val === "object") {
      content = JSON.stringify(val, null, 2);
    } else {
      content = String(val);
    }

    const ext = "json";
    const filePath = path.join(outDir, `${key}.${ext}`);
    await fs.writeFile(filePath, content, "utf-8");
    summary[key] = `${content.length} chars → ${key}.${ext}`;
  }

  // For generatedMechanics, also dump each mechanic as a separate .ts file
  if (cv.generatedMechanics && typeof cv.generatedMechanics === "object") {
    const mechanicsDir = path.join(outDir, "mechanics");
    await fs.mkdir(mechanicsDir, { recursive: true });
    const mechanics = cv.generatedMechanics as Record<string, string>;
    for (const [id, code] of Object.entries(mechanics)) {
      const mechanicPath = path.join(mechanicsDir, `${id}.ts`);
      await fs.writeFile(mechanicPath, code, "utf-8");
      summary[`mechanics/${id}.ts`] = `${code.length} chars`;
    }
  }

  // Dump game state too (useful for debugging)
  if (cv.gameState) {
    const gsPath = path.join(outDir, "gameState.json");
    try {
      const gs = typeof cv.gameState === "string" ? JSON.parse(cv.gameState as string) : cv.gameState;
      await fs.writeFile(gsPath, JSON.stringify(gs, null, 2), "utf-8");
      summary["gameState"] = `→ gameState.json`;
    } catch {
      await fs.writeFile(gsPath, String(cv.gameState), "utf-8");
      summary["gameState"] = `→ gameState.json (raw)`;
    }
  }

  // Print summary
  console.log(`\nDumped to ${outDir}:`);
  for (const [key, desc] of Object.entries(summary)) {
    console.log(`  ${key}: ${desc}`);
  }
}

// ── Main ──

const baseDir = path.join(process.cwd(), "data", "exports", sessionId);

console.log(`Dumping runtime checkpoint for session ${sessionId}...`);
await dumpCheckpoint(sessionId, "game-simulation", path.join(baseDir, "runtime"));

if (specKey) {
  console.log(`\nDumping spec-processing checkpoint for ${specKey}...`);
  await dumpCheckpoint(specKey, "game-simulation", path.join(baseDir, "spec-processing"));
}

console.log("\nDone.");
