/**
 * Sim Assistant tool definitions.
 *
 * Artifact tools close over a lazily-loaded, cached snapshot of game artifacts
 * (gameRules, stateSchema, stateTransitions, instructions, mechanics).
 * The cache is populated on first tool invocation and reused for all subsequent
 * calls. Call `invalidate()` (returned by the factory) after artifact repairs
 * to force a reload on the next access.
 *
 * History tools (getRecentStates) still iterate live checkpoints because
 * runtime state changes every turn.
 *
 * Action tools (repairArtifacts, restartSimulation) are defined in Phase 2.
 */
import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { RuntimeStateType } from "#chaincraft/ai/simulate/graphs/runtime-graph/runtime-state.js";
import type { SimArtifactCache } from "#chaincraft/ai/simulate/artifacts.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Snapshot of game state from a single checkpoint. */
interface StateSnapshot {
  phase: string;
  gameState: string;
  playerAction?: { playerId: string; playerAction: string };
}

/** Cached artifacts — lazily loaded, invalidated after repairs. */
export type ArtifactSnapshot = SimArtifactCache;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Return type from {@link createRetrievalTools}. */
export interface RetrievalToolkit {
  tools: StructuredToolInterface[];
  /** Clear the cached artifact snapshot. Next tool call will reload from checkpoint. */
  invalidate: () => void;
  /** Returns cached artifacts, loading on first access or after invalidation. */
  getArtifacts: () => Promise<ArtifactSnapshot | undefined>;
}

/**
 * Loads artifacts from the latest runtime checkpoint.
 * Returns undefined if no checkpoint exists.
 */
async function loadArtifacts(
  saver: BaseCheckpointSaver,
  sessionId: string,
): Promise<ArtifactSnapshot | undefined> {
  const config = { configurable: { thread_id: sessionId } };
  const checkpoint = await saver.getTuple(config);
  const cv = checkpoint?.checkpoint?.channel_values as
    | RuntimeStateType
    | undefined;
  if (!cv) return undefined;
  return {
    gameRules: cv.gameRules || "",
    stateSchema: cv.stateSchema || "",
    stateTransitions: cv.stateTransitions || "",
    transitionInstructions: cv.transitionInstructions ?? {},
    playerPhaseInstructions: cv.playerPhaseInstructions ?? {},
    generatedMechanics: cv.generatedMechanics ?? {},
  } satisfies ArtifactSnapshot;
}

// ─── Tool Factory ─────────────────────────────────────────────────────────────

/**
 * Creates the retrieval tools for the sim assistant, bound to a specific
 * runtime session's checkpointer.
 *
 * Artifact tools lazily load and cache a snapshot on first invocation.
 * Call `invalidate()` on the returned toolkit after artifact repairs to
 * force a reload on the next tool call.
 *
 * @param saver - The runtime graph's checkpoint saver
 * @param sessionId - The runtime graph's thread_id (= simulation sessionId)
 */
export function createRetrievalTools(
  saver: BaseCheckpointSaver,
  sessionId: string,
): RetrievalToolkit {
  const cache: { current: ArtifactSnapshot | null | undefined } = {
    current: undefined,
  };
  const NO_DATA =
    "No checkpoint data available — simulation may not have started yet.";

  /** Returns cached artifacts, loading on first access or after invalidation. */
  async function getArtifacts(): Promise<ArtifactSnapshot | undefined> {
    if (cache.current === undefined) {
      cache.current = (await loadArtifacts(saver, sessionId)) ?? null;
    }
    return cache.current ?? undefined;
  }

  // ── Artifact tools (read from cached snapshot) ────────────────────────────

  const getGameSpec = tool(
    async () => {
      const artifacts = await getArtifacts();
      if (!artifacts) return NO_DATA;
      return artifacts.gameRules || "No game specification found.";
    },
    {
      name: "getGameSpec",
      description: "Returns the full game specification/rules text.",
      schema: z.object({}),
    },
  );

  // ── History tools (live checkpoint access) ────────────────────────────────

  const getRecentStates = tool(
    async ({ count }) => {
      const n = count ?? 5;
      const config = { configurable: { thread_id: sessionId } };
      const snapshots: StateSnapshot[] = [];

      for await (const entry of saver.list(config)) {
        if (snapshots.length >= n) break;
        const cv = entry.checkpoint?.channel_values as
          | RuntimeStateType
          | undefined;
        if (!cv) continue;
        snapshots.push({
          phase: cv.currentPhase || "unknown",
          gameState: cv.gameState || "{}",
          playerAction: cv.playerAction ?? undefined,
        });
      }

      if (snapshots.length === 0) return "No state history available.";

      // Reverse so oldest is first (chronological order)
      snapshots.reverse();

      return snapshots
        .map((s, i) => {
          const actionStr = s.playerAction
            ? `Action: ${s.playerAction.playerId}: ${s.playerAction.playerAction}`
            : "Action: (automatic transition)";
          return `--- Snapshot ${i + 1} (phase: ${s.phase}) ---\n${actionStr}\nState: ${s.gameState}`;
        })
        .join("\n\n");
    },
    {
      name: "getRecentStates",
      description:
        "Returns the last N game state snapshots from checkpoint history (default 5). " +
        "Each includes the phase, the action that triggered it, and the full game state. " +
        "Call with a larger count to look further back.",
      schema: z.object({
        count: z
          .number()
          .optional()
          .describe("Number of recent states to return (default 5)"),
      }),
    },
  );

  return {
    tools: [getGameSpec, getRecentStates],
    invalidate: () => {
      cache.current = undefined;
    },
    getArtifacts,
  };
}
