/**
 * Sim Assistant handler — manages graph lifecycle and message dispatch.
 *
 * - Lazily creates/caches one sim assistant graph per sessionId
 * - On each incoming message: builds manifest, invokes graph, streams
 *   response tokens to the SSE bus
 */
import { HumanMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { LRUCache } from 'lru-cache';

import { getSaver } from '#chaincraft/ai/memory/checkpoint-memory.js';
import { getConfig } from '#chaincraft/config.js';
import { createSimAssistantGraphConfig } from '#chaincraft/ai/graph-config.js';
import {
  createSimAssistantGraph,
  type SimAssistantGraphResult,
} from '#chaincraft/ai/simulate/graphs/sim-assistant-graph/index.js';
import { buildManifest } from '#chaincraft/ai/simulate/graphs/sim-assistant-graph/prompts.js';
import {
  getBus,
  appendBufferedEvent,
  type SimAssistantEvent,
} from '#chaincraft/events/sim-assistant-bus.js';

// ─── Graph Cache ──────────────────────────────────────────────────────────────

const assistantCache = new LRUCache<string, SimAssistantGraphResult>({
  max: parseInt(process.env.CHAINCRAFT_SIM_ASSISTANT_CACHE_SIZE ?? '50'),
});

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Handles an incoming user message for the sim assistant.
 *
 * 1. Gets/builds the assistant graph (cached per sessionId)
 * 2. Builds a fresh manifest from the runtime checkpoint
 * 3. Invokes the graph with the user message
 * 4. Streams response tokens to the SSE bus
 *
 * Runs as a fire-and-forget background task (caller returns 202 immediately).
 */
export async function handleAssistantMessage(
  sessionId: string,
  gameId: string,
  message: string,
): Promise<void> {
  const bus = getBus(sessionId);
  const emit = (event: SimAssistantEvent) => {
    appendBufferedEvent(sessionId, event);
    bus?.emit(event);
  };

  try {
    // Get runtime saver for manifest building
    const runtimeSaver = await getSaver(
      sessionId,
      getConfig('simulation-graph-type'),
    );

    // Build fresh manifest from latest runtime state
    const manifest = await buildManifest(runtimeSaver, sessionId);

    // Get or build cached assistant graph
    let cached = assistantCache.get(sessionId);
    if (!cached) {
      const assistantSaver = await getSaver(
        sessionId,
        getConfig('sim-assistant-graph-type'),
      );
      cached = await createSimAssistantGraph(
        assistantSaver,
        runtimeSaver,
        sessionId,
      );
      assistantCache.set(sessionId, cached);
    }

    const config = createSimAssistantGraphConfig(sessionId);

    // Invoke the graph
    const result = await cached.graph.invoke(
      {
        messages: [new HumanMessage(message)],
        sessionId,
        gameId,
        manifest,
      },
      config,
    );

    // Extract the last AI message as the complete response
    const messages: BaseMessage[] = result.messages ?? [];
    const lastAi = [...messages].reverse().find(m => m._getType() === 'ai');
    const content = lastAi
      ? (typeof lastAi.content === 'string' ? lastAi.content : JSON.stringify(lastAi.content))
      : '';

    emit({ type: 'message:complete', content });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[sim-assistant] Error processing message for ${sessionId}:`, errorMessage);
    emit({ type: 'error', error: errorMessage });
  }
}
