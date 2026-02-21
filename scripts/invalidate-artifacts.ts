#!/usr/bin/env node
import "dotenv/config.js";

import { deleteThread } from "#chaincraft/ai/memory/checkpoint-memory.js";
import { getCachedSpecArtifacts } from "#chaincraft/ai/simulate/simulate-workflow.js";
import { getCachedDesign } from "#chaincraft/ai/design/design-workflow.js";
import { getConfig } from "#chaincraft/config.js";

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        parsed[key] = next;
        i++;
      } else {
        parsed[key] = true;
      }
    }
  }

  return parsed;
}

async function main() {
  const args = parseArgs();
  const gameIdRaw = args["gameId"];
  if (!gameIdRaw || typeof gameIdRaw !== "string") {
    throw new Error("Missing required argument --gameId");
  }

  let versionStr = typeof args["version"] === "string" ? (args["version"] as string) : undefined;

  if (!versionStr) {
    console.log("[invalidate-artifacts] --version not provided, loading latest design version...");
    const design = await getCachedDesign(gameIdRaw);
    const latestVersion = design?.specification?.version;
    if (latestVersion === undefined || latestVersion === null) {
      throw new Error("Could not determine latest version from cached design; please specify --version");
    }
    versionStr = String(latestVersion);
    console.log(`[invalidate-artifacts] Resolved latest version=${versionStr}`);
  }

  const specKey = `${gameIdRaw}-v${versionStr}`;
  const graphType = getConfig("simulation-graph-type");

  console.log(`[invalidate-artifacts] Target specKey=${specKey}, graphType=${graphType}`);

  const existing = await getCachedSpecArtifacts(specKey);
  if (!existing) {
    console.log("[invalidate-artifacts] No cached artifacts found (already empty or never generated). Proceeding to delete thread to force regen.");
  } else {
    console.log("[invalidate-artifacts] Cached artifacts found. Deleting thread to force regeneration on next sim run.");
  }

  await deleteThread(specKey, graphType);
  console.log("[invalidate-artifacts] Deleted checkpoint thread. Next simulation run will regenerate artifacts.");
}

main().catch((error) => {
  console.error("[invalidate-artifacts] Failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});