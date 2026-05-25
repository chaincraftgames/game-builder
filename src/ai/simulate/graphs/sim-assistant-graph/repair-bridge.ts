/**
 * Repair bridge — translates sim assistant diagnosis into artifact editor
 * invocations, then writes repaired artifacts back to the runtime checkpoint.
 *
 * Two exports:
 * - `updateRuntimeArtifacts()` — low-level checkpoint writer
 * - `createRepairTool()` — the `repairArtifacts` LangGraph tool
 */
import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import type { BaseCheckpointSaver } from "@langchain/langgraph";

import { createArtifactEditorGraph } from "#chaincraft/ai/simulate/graphs/artifact-editor-graph/index.js";
import {
  deriveSchemaFieldsSummary,
  parseInstructionMap,
  serializeInstructionMap,
} from "#chaincraft/ai/simulate/graphs/artifact-editor-graph/utils.js";
import { createArtifactEditorGraphConfig } from "#chaincraft/ai/graph-config.js";
import type { SimAssistantBus } from "#chaincraft/events/sim-assistant-bus.js";
import type { GameStateField } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-schema/schema.js";
import { generateStateInterfaces } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/generate-mechanics/generate-state-interfaces.js";
import type {
  RuntimeStateType,
  RepairRecord,
} from "#chaincraft/ai/simulate/graphs/runtime-graph/runtime-state.js";

// ─── Types ────────────────────────────────────────────────────────────────────

import { REPAIRABLE_ARTIFACT_KEYS } from "#chaincraft/ai/simulate/artifacts.js";
import { promoteArtifactsToSpecCache } from "#chaincraft/ai/simulate/simulate-workflow.js";
import type {
  ArtifactPatch,
  ArtifactSnapshot,
  SimArtifactCache,
} from "#chaincraft/ai/simulate/artifacts.js";

// ─── Checkpoint Writer ────────────────────────────────────────────────────────

/**
 * Overwrites artifact fields in the latest runtime checkpoint **in-place**
 * (same checkpoint ID → SQL `INSERT OR REPLACE`).
 *
 * This avoids triggering graph node execution — we write directly through
 * the saver, not through `graph.invoke()`.
 */
export async function updateRuntimeArtifacts(
  saver: BaseCheckpointSaver,
  sessionId: string,
  patch: ArtifactPatch,
): Promise<void> {
  const config = { configurable: { thread_id: sessionId } };
  const tuple = await saver.getTuple(config);
  if (!tuple) {
    throw new Error(`No runtime checkpoint found for session ${sessionId}`);
  }

  const cv = tuple.checkpoint.channel_values as Record<string, unknown>;

  // Overwrite only the fields present in the patch
  for (const key of REPAIRABLE_ARTIFACT_KEYS) {
    if (patch[key] !== undefined) {
      cv[key] = patch[key];
    }
  }

  // Write back with the same checkpoint ID (in-place overwrite).
  // Concrete savers (SqliteSaver, MemorySaver) accept 3 args.
  const metadata = tuple.metadata ?? {
    source: "update" as const,
    step: -1,
    parents: {},
  };
  await (saver as any).put(tuple.config, tuple.checkpoint, metadata);

  console.log(
    `[repair-bridge] Updated runtime artifacts for session ${sessionId}`,
  );
}

// ─── State Snapshot Loader ─────────────────────────────────────────────────────

/** Load recent game state snapshots from checkpoint history for coordinator context. */
async function loadRecentStateSnapshots(
  saver: BaseCheckpointSaver,
  sessionId: string,
  count = 5,
): Promise<string> {
  const config = { configurable: { thread_id: sessionId } };
  const snapshots: Array<{
    phase: string;
    gameState: string;
    playerAction?: { playerId: string; playerAction: string };
  }> = [];

  for await (const entry of saver.list(config)) {
    if (snapshots.length >= count) break;
    const cv = entry.checkpoint?.channel_values as RuntimeStateType | undefined;
    if (!cv) continue;
    snapshots.push({
      phase: cv.currentPhase || "unknown",
      gameState: cv.gameState || "{}",
      playerAction: cv.playerAction ?? undefined,
    });
  }

  if (snapshots.length === 0) return "";
  snapshots.reverse();

  return snapshots
    .map((s, i) => {
      const actionStr = s.playerAction
        ? `Action: ${s.playerAction.playerId}: ${s.playerAction.playerAction}`
        : "Action: (automatic transition)";
      return `--- Snapshot ${i + 1} (phase: ${s.phase}) ---\n${actionStr}\nState: ${s.gameState}`;
    })
    .join("\n\n");
}

// ─── Repair Tool Factory ──────────────────────────────────────────────────────

// ─── Snapshot & History Helpers ────────────────────────────────────────────────

/**
 * Saves the current artifact values as a snapshot on the checkpoint,
 * and returns the existing repair history.
 */
async function saveSnapshotAndGetHistory(
  saver: BaseCheckpointSaver,
  sessionId: string,
  artifacts: ArtifactSnapshot,
): Promise<RepairRecord[]> {
  const config = { configurable: { thread_id: sessionId } };
  const tuple = await saver.getTuple(config);
  if (!tuple) return [];

  const cv = tuple.checkpoint.channel_values as Record<string, unknown>;

  // Save snapshot of current (pre-repair) artifacts
  const snapshot: ArtifactSnapshot = {
    stateSchema: artifacts.stateSchema,
    stateTransitions: artifacts.stateTransitions,
    playerPhaseInstructions: { ...artifacts.playerPhaseInstructions },
    transitionInstructions: { ...artifacts.transitionInstructions },
    generatedMechanics: { ...artifacts.generatedMechanics },
  };
  cv.artifactSnapshot = snapshot;

  // Write back checkpoint with snapshot
  const metadata = tuple.metadata ?? {
    source: "update" as const,
    step: -1,
    parents: {},
  };
  await (saver as any).put(tuple.config, tuple.checkpoint, metadata);

  console.log(
    `[repair-bridge] Saved artifact snapshot for session ${sessionId}`,
  );

  return (cv.repairHistory as RepairRecord[]) ?? [];
}

/**
 * Appends a repair record to the checkpoint's repair history.
 */
async function appendRepairRecord(
  saver: BaseCheckpointSaver,
  sessionId: string,
  record: RepairRecord,
): Promise<void> {
  const config = { configurable: { thread_id: sessionId } };
  const tuple = await saver.getTuple(config);
  if (!tuple) return;

  const cv = tuple.checkpoint.channel_values as Record<string, unknown>;
  const history = (cv.repairHistory as RepairRecord[]) ?? [];
  cv.repairHistory = [...history, record];

  const metadata = tuple.metadata ?? {
    source: "update" as const,
    step: -1,
    parents: {},
  };
  await (saver as any).put(tuple.config, tuple.checkpoint, metadata);

  console.log(
    `[repair-bridge] Appended repair record #${record.attempt} for session ${sessionId}`,
  );
}

export interface RepairToolDeps {
  runtimeSaver: BaseCheckpointSaver;
  sessionId: string;
  /** Callback to get latest cached artifacts (from retrieval toolkit). */
  getArtifacts: () => Promise<SimArtifactCache | undefined>;
  /** Callback to invalidate the artifact cache after repair. */
  invalidateCache: () => void;
  /** Optional: SSE event bus for streaming repair progress. */
  getBus: () => SimAssistantBus | undefined;
}

/**
 * Creates the `repairArtifacts` tool.
 *
 * The LLM calls this with a list of symptom descriptions (what went wrong
 * from the game's perspective). The tool:
 * 1. Loads current artifacts from the cache
 * 2. Loads recent game state snapshots for diagnostic context
 * 3. Invokes the artifact editor graph with symptoms + state context
 * 4. Writes repaired artifacts back to the runtime checkpoint
 * 5. Invalidates the cache so subsequent reads see the repairs
 * 6. Emits SSE events for frontend progress display
 */
export function createRepairTool(
  deps: RepairToolDeps,
): StructuredToolInterface {
  return tool(
    async ({ symptoms }) => {
      const { runtimeSaver, sessionId, getArtifacts, invalidateCache, getBus } =
        deps;
      const bus = getBus();

      try {
        // 1. Load current artifacts
        const artifacts = await getArtifacts();
        if (!artifacts) {
          return "Cannot repair: no artifacts found in runtime checkpoint. The simulation may not have been created yet.";
        }

        bus?.emit({
          type: "repair:started",
          description: `Repairing artifacts based on ${symptoms.length} reported symptom(s)`,
        });

        // 1b. Snapshot current artifacts and load repair history
        const priorHistory = await saveSnapshotAndGetHistory(
          runtimeSaver,
          sessionId,
          artifacts,
        );
        const attemptNumber = priorHistory.length + 1;

        // 2. Load recent state snapshots for coordinator context
        const stateContext = await loadRecentStateSnapshots(
          runtimeSaver,
          sessionId,
        );

        // 3. Build artifact editor input
        const playerPhaseInstructions = parseInstructionMap(
          artifacts.playerPhaseInstructions,
        );
        const transitionInstructions = parseInstructionMap(
          artifacts.transitionInstructions,
        );
        const generatedMechanics = artifacts.generatedMechanics;
        const hasMechanics = Object.keys(generatedMechanics).length > 0;

        // Generate stateInterfaces if mechanics exist (needed for tsc validation)
        let stateInterfaces = "";
        if (hasMechanics) {
          try {
            const fields: GameStateField[] = JSON.parse(artifacts.stateSchema);
            stateInterfaces = generateStateInterfaces(fields);
          } catch {
            // Schema may not be GameStateField[] format — that's okay
          }
        }

        bus?.emit({
          type: "repair:progress",
          step: "Invoking artifact editor coordinator",
          operation: "patch",
        });

        const graph = await createArtifactEditorGraph();
        const graphConfig = createArtifactEditorGraphConfig(
          `${sessionId}-sim-assistant-repair`,
        );

        // Build errors for coordinator: symptoms enriched with state context
        const errors = stateContext
          ? symptoms.map(
              (s) => `Symptom: ${s}\n\nRecent game state:\n${stateContext}`,
            )
          : symptoms.map((s) => `Symptom: ${s}`);

        const editorInput = {
          gameSpecification: artifacts.gameRules,
          errors,
          schemaFields: deriveSchemaFieldsSummary(artifacts.stateSchema),
          stateSchema: artifacts.stateSchema,
          stateTransitions: artifacts.stateTransitions,
          playerPhaseInstructions,
          transitionInstructions,
          ...(hasMechanics ? { generatedMechanics, stateInterfaces } : {}),
          // Pass repair history so the coordinator avoids repeating failed strategies
          ...(priorHistory.length > 0 ? { repairHistory: priorHistory } : {}),
        };

        const result = await graph.invoke(editorInput, graphConfig);

        // 4. Check result
        if (!result.editSucceeded) {
          const remaining = result.remainingErrors ?? [];
          bus?.emit({
            type: "repair:error",
            error: `Repair failed with ${remaining.length} remaining error(s)`,
          });

          // Log failed repair to history
          await appendRepairRecord(runtimeSaver, sessionId, {
            attempt: attemptNumber,
            symptoms,
            changesSummary: (result.changesApplied ?? []).map(
              (c: { artifact?: string; description?: string }) =>
                `${c.artifact ?? "unknown"}: ${c.description ?? "attempted"}`,
            ),
            succeeded: false,
            timestamp: new Date().toISOString(),
          });

          return `Repair failed. Remaining errors:\n${remaining.join("\n")}. A snapshot of the pre-repair artifacts has been saved — you can roll back if needed.`;
        }

        // 4. Build patch from editor output and write to runtime checkpoint
        bus?.emit({
          type: "repair:progress",
          step: "Writing repaired artifacts to runtime checkpoint",
        });

        const patch: ArtifactPatch = {
          stateSchema: result.stateSchema || artifacts.stateSchema,
          stateTransitions:
            result.stateTransitions || artifacts.stateTransitions,
          playerPhaseInstructions: serializeInstructionMap(
            (result.playerPhaseInstructions ?? {}) as Record<string, unknown>,
          ),
          transitionInstructions: serializeInstructionMap(
            (result.transitionInstructions ?? {}) as Record<string, unknown>,
          ),
        };

        if (
          result.generatedMechanics &&
          Object.keys(result.generatedMechanics).length > 0
        ) {
          patch.generatedMechanics = result.generatedMechanics;
        }

        await updateRuntimeArtifacts(runtimeSaver, sessionId, patch);

        // 5. Promote repaired artifacts to spec cache so future sessions inherit them
        bus?.emit({
          type: "repair:progress",
          step: "Promoting repaired artifacts to spec cache",
        });
        await promoteArtifactsToSpecCache(sessionId);

        // 6. Invalidate cache + emit completion
        invalidateCache();

        // Summarize what changed
        const changes = result.changesApplied ?? [];
        const summary =
          changes.length > 0
            ? changes
                .map(
                  (c: { artifact?: string; description?: string }) =>
                    `${c.artifact ?? "unknown"}: ${c.description ?? "updated"}`,
                )
                .join("; ")
            : "Artifacts repaired successfully";

        bus?.emit({ type: "repair:completed", summary });

        // Log successful repair to history
        await appendRepairRecord(runtimeSaver, sessionId, {
          attempt: attemptNumber,
          symptoms,
          changesSummary: changes.map(
            (c: { artifact?: string; description?: string }) =>
              `${c.artifact ?? "unknown"}: ${c.description ?? "updated"}`,
          ),
          succeeded: true,
          timestamp: new Date().toISOString(),
        });

        return `Repair succeeded. ${summary}. The artifact cache has been refreshed. You can now restart the simulation if needed.`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[repair-bridge] Repair failed for ${sessionId}:`, err);
        bus?.emit({ type: "repair:error", error: msg });
        return `Repair failed with an unexpected error: ${msg}`;
      }
    },
    {
      name: "repairArtifacts",
      description:
        "Escalates to the repair system to fix game issues. Provide symptom descriptions — " +
        'what went wrong from the game\'s perspective (e.g., "game stuck after first round", ' +
        '"player 2 never got a turn"). The repair system will diagnose the root cause and fix it. ' +
        "Only call this after the creator has confirmed they want repairs applied.",
      schema: z.object({
        symptoms: z
          .array(z.string())
          .min(1)
          .describe(
            "List of symptom descriptions — what went wrong from the game's perspective. " +
              "Describe observable behavior, not technical root causes.",
          ),
      }),
    },
  );
}
