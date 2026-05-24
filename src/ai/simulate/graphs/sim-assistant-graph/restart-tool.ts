/**
 * Restart simulation tool — resets the runtime graph and re-initializes
 * from repaired artifacts already stored in the checkpoint.
 */
import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import type { BaseCheckpointSaver } from '@langchain/langgraph';

import { initializeSimulation } from '#chaincraft/ai/simulate/simulate-workflow.js';
import type { RuntimeStateType } from '#chaincraft/ai/simulate/graphs/runtime-graph/runtime-state.js';
import type { SimAssistantBus } from '#chaincraft/events/sim-assistant-bus.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RestartToolDeps {
  runtimeSaver: BaseCheckpointSaver;
  sessionId: string;
  /** Optional: SSE event bus for streaming restart progress. */
  getBus: () => SimAssistantBus | undefined;
}

// ─── Artifact field names to preserve across restart ──────────────────────────

import { RESTART_PRESERVED_KEYS } from '#chaincraft/ai/simulate/artifacts.js';

const ARTIFACT_FIELDS: (keyof RuntimeStateType)[] = [...RESTART_PRESERVED_KEYS];

/**
 * Resets the runtime checkpoint to artifact-only state: preserves artifacts
 * and clears all runtime/game state so the graph behaves as if init was
 * never called.
 */
export async function resetCheckpointToArtifacts(
  saver: BaseCheckpointSaver,
  sessionId: string,
): Promise<string[]> {
  const config = { configurable: { thread_id: sessionId } };
  const tuple = await saver.getTuple(config);
  if (!tuple) {
    throw new Error(`No runtime checkpoint found for session ${sessionId}`);
  }

  const cv = tuple.checkpoint.channel_values as Record<string, unknown>;

  // Save players before clearing (we need them for re-init)
  const players = (cv.players as string[]) ?? [];

  // Preserve only artifact fields, reset everything else
  const preserved: Record<string, unknown> = {};
  for (const field of ARTIFACT_FIELDS) {
    if (cv[field] !== undefined) {
      preserved[field] = cv[field];
    }
  }

  // Clear all channel values and restore only artifacts + defaults
  for (const key of Object.keys(cv)) {
    delete cv[key];
  }
  Object.assign(cv, preserved);

  // Set runtime defaults explicitly so the router sees a clean slate
  cv.players = [];
  cv.gameState = '';
  cv.playerMapping = '{}';
  cv.isInitialized = false;
  cv.currentPhase = '';
  cv.selectedInstructions = '';
  cv.requiresPlayerInput = true;
  cv.transitionReady = false;
  cv.nextPhase = '';
  cv.winningPlayers = [];
  cv.playerAction = undefined;
  cv.imagePrompt = undefined;

  // Write back with same checkpoint ID (in-place overwrite)
  const metadata = tuple.metadata ?? { source: 'update' as const, step: -1, parents: {} };
  await (saver as any).put(tuple.config, tuple.checkpoint, metadata);

  console.log(`[restart-tool] Reset checkpoint to artifact-only state for session ${sessionId}`);
  return players;
}

// ─── Restart Tool Factory ─────────────────────────────────────────────────────

/**
 * Creates the `restartSimulation` tool.
 *
 * Resets the runtime checkpoint to artifact-only state (clearing all game
 * state, errors, and flags), then calls `initializeSimulation()` to
 * re-initialize from repaired artifacts.
 */
export function createRestartTool(deps: RestartToolDeps): StructuredToolInterface {
  return tool(
    async () => {
      const { runtimeSaver, sessionId, getBus } = deps;
      const bus = getBus();

      try {
        // Reset checkpoint and extract players before clearing
        const players = await resetCheckpointToArtifacts(runtimeSaver, sessionId);

        if (players.length === 0) {
          return 'Cannot restart: no players found in runtime checkpoint. The simulation may not have been initialized yet.';
        }

        bus?.emit({
          type: 'repair:progress',
          step: `Restarting simulation with ${players.length} player(s)`,
        });

        const result = await initializeSimulation(sessionId, players);

        // Check if the sim reported an error despite "succeeding"
        const hasError = result.publicMessage &&
          (result.publicMessage.toLowerCase().includes('error') ||
           result.publicMessage.toLowerCase().includes('deadlock'));

        const summary = hasError
          ? `Restart failed: simulation initialized ${players.length} player(s) but hit an error immediately. ${result.publicMessage}`
          : result.publicMessage
            ? `Simulation restarted successfully with ${players.length} player(s). ${result.publicMessage}`
            : `Simulation restarted successfully with ${players.length} player(s).`;

        bus?.emit({ type: 'repair:completed', summary });

        // Emit game:restart so the frontend can clear old messages and display new init messages
        if (!hasError) {
          const playerStatesObj: Record<string, { privateMessage?: string }> = {};
          for (const [playerId, state] of result.playerStates) {
            playerStatesObj[playerId] = { privateMessage: state.privateMessage };
          }
          bus?.emit({
            type: 'game:restart',
            publicMessage: result.publicMessage,
            playerStates: playerStatesObj,
          });
        }

        return summary;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[restart-tool] Restart failed for ${sessionId}:`, msg);
        bus?.emit({ type: 'repair:error', error: msg });
        return `Restart failed: ${msg}`;
      }
    },
    {
      name: 'restartSimulation',
      description:
        'Restarts the simulation from the beginning using the current artifacts ' +
        '(including any recent repairs). All game state is fully reset — only ' +
        'artifacts are preserved. Only call this after artifacts have been repaired ' +
        'and the creator has confirmed they want to restart.',
      schema: z.object({}),
    },
  );
}
