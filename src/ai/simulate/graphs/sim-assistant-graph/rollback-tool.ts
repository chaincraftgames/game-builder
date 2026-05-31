/**
 * Rollback tool — restores artifacts to the pre-repair snapshot when a
 * repair causes catastrophic damage that the repair system can't fix.
 *
 * The sim assistant calls this when a restart after repair fails and the
 * creator wants to undo the last repair.
 */
import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import type { BaseCheckpointSaver } from '@langchain/langgraph';

import type { RepairRecord } from '#chaincraft/ai/simulate/graphs/runtime-graph/runtime-state.js';
import type { ArtifactSnapshot } from '#chaincraft/ai/simulate/artifacts.js';
import type { SimAssistantBus } from '#chaincraft/events/sim-assistant-bus.js';
import { promoteArtifactsToSpecCache } from '#chaincraft/ai/simulate/simulate-workflow.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RollbackToolDeps {
  runtimeSaver: BaseCheckpointSaver;
  sessionId: string;
  /** Callback to invalidate the artifact cache after rollback. */
  invalidateCache: () => void;
  /** Optional: SSE event bus for streaming progress. */
  getBus: () => SimAssistantBus | undefined;
}

// ─── Rollback Tool Factory ────────────────────────────────────────────────────

/**
 * Creates the `rollbackArtifacts` tool.
 *
 * Restores artifact fields from the pre-repair snapshot saved on the
 * checkpoint. Also removes the last repair record from history (since
 * its changes are being undone) and clears the snapshot.
 */
export function createRollbackTool(deps: RollbackToolDeps): StructuredToolInterface {
  return tool(
    async () => {
      const { runtimeSaver, sessionId, invalidateCache, getBus } = deps;
      const bus = getBus();

      try {
        const config = { configurable: { thread_id: sessionId } };
        const tuple = await runtimeSaver.getTuple(config);
        if (!tuple) {
          return 'Cannot roll back: no runtime checkpoint found for this session.';
        }

        const cv = tuple.checkpoint.channel_values as Record<string, unknown>;
        const snapshot = cv.artifactSnapshot as ArtifactSnapshot | null;

        if (!snapshot) {
          return 'Cannot roll back: no pre-repair snapshot available. This means either no repair has been attempted, or the snapshot was already consumed by a previous rollback.';
        }

        bus?.emit({
          type: 'repair:progress',
          step: 'Rolling back to pre-repair artifact state',
        });

        // Restore artifact fields from snapshot
        const { REPAIRABLE_ARTIFACT_KEYS } = await import('#chaincraft/ai/simulate/artifacts.js');
        for (const key of REPAIRABLE_ARTIFACT_KEYS) {
          cv[key] = snapshot[key];
        }

        // Remove the last repair record (it's being undone)
        const history = (cv.repairHistory as RepairRecord[]) ?? [];
        if (history.length > 0) {
          cv.repairHistory = history.slice(0, -1);
        }

        // Clear the snapshot (one-time use)
        cv.artifactSnapshot = null;

        // Write back
        const metadata = tuple.metadata ?? { source: 'update' as const, step: -1, parents: {} };
        await (runtimeSaver as any).put(tuple.config, tuple.checkpoint, metadata, tuple.checkpoint.channel_versions ?? {});

        // Also roll back the spec cache so future sessions get the pre-repair artifacts
        await promoteArtifactsToSpecCache(sessionId);

        // Invalidate cache so tools see reverted artifacts
        invalidateCache();

        console.log(`[rollback-tool] Rolled back artifacts for session ${sessionId}`);

        bus?.emit({
          type: 'repair:completed',
          summary: 'Rolled back to pre-repair artifact state',
        });

        return 'Artifacts rolled back to the state before the last repair. The artifact cache has been refreshed. You can now try a different repair approach or restart the simulation.';
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[rollback-tool] Rollback failed for ${sessionId}:`, msg);
        bus?.emit({ type: 'repair:error', error: `Rollback failed: ${msg}` });
        return `Rollback failed: ${msg}`;
      }
    },
    {
      name: 'rollbackArtifacts',
      description:
        'Undoes the last repair by restoring artifacts to their pre-repair state. ' +
        'Use this when a repair made things worse and the simulation cannot recover. ' +
        'Only one level of rollback is available (the most recent repair). ' +
        'After rolling back, you can attempt a different repair or restart.',
      schema: z.object({}),
    },
  );
}
