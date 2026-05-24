/**
 * Sim Assistant graph — a ReAct agent that helps game creators diagnose,
 * repair, and restart simulation behavior.
 *
 * Uses `createAgent` from `langchain` with:
 * - Lazy-cached retrieval tools bound to the runtime graph's checkpointer
 * - Action tools: repairArtifacts (artifact editor bridge) and restartSimulation
 * - A `dynamicSystemPromptMiddleware` that reads the manifest from state each
 *   invocation and builds a contextual system prompt
 * - Its own checkpointer for conversation persistence (design conversation pattern)
 */
import { createAgent, dynamicSystemPromptMiddleware } from "langchain";
import type { BaseCheckpointSaver } from "@langchain/langgraph";

import {
  SimAssistantState,
  type SimAssistantStateType,
} from "#chaincraft/ai/simulate/graphs/sim-assistant-graph/sim-assistant-state.js";
import { buildSystemPrompt } from "#chaincraft/ai/simulate/graphs/sim-assistant-graph/prompts.js";
import {
  createRetrievalTools,
  type RetrievalToolkit,
} from "#chaincraft/ai/simulate/graphs/sim-assistant-graph/tools.js";
import { createRepairTool } from "#chaincraft/ai/simulate/graphs/sim-assistant-graph/repair-bridge.js";
import { createRestartTool } from "#chaincraft/ai/simulate/graphs/sim-assistant-graph/restart-tool.js";
import { createRollbackTool } from "#chaincraft/ai/simulate/graphs/sim-assistant-graph/rollback-tool.js";
import { setupSimAssistantModel } from "#chaincraft/ai/model-config.js";
import { getBus } from "#chaincraft/events/sim-assistant-bus.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Value returned by {@link createSimAssistantGraph}. */
export interface SimAssistantGraphResult {
  /** Compiled ReAct graph, ready to invoke/stream. */
  graph: ReturnType<typeof createAgent>;
  /** Toolkit with tools array + `invalidate()` for post-repair cache clearing. */
  toolkit: RetrievalToolkit;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a compiled sim assistant ReAct agent graph.
 *
 * @param assistantCheckpointer - Checkpointer for the assistant's own
 *   conversation history (thread_id = sessionId).
 * @param runtimeSaver - The runtime graph's checkpointer, used by retrieval
 *   tools to read game artifacts and state history.
 * @param sessionId - Runtime session ID (shared with the runtime graph).
 */
export async function createSimAssistantGraph(
  assistantCheckpointer: BaseCheckpointSaver,
  runtimeSaver: BaseCheckpointSaver,
  sessionId: string,
): Promise<SimAssistantGraphResult> {
  const model = await setupSimAssistantModel();
  const toolkit = createRetrievalTools(runtimeSaver, sessionId);

  // Action tools — repair + restart + rollback
  const repairTool = createRepairTool({
    runtimeSaver,
    sessionId,
    getArtifacts: toolkit.getArtifacts,
    invalidateCache: toolkit.invalidate,
    getBus: () => getBus(sessionId),
  });

  const restartTool = createRestartTool({
    runtimeSaver,
    sessionId,
    getBus: () => getBus(sessionId),
  });

  const rollbackTool = createRollbackTool({
    runtimeSaver,
    sessionId,
    invalidateCache: toolkit.invalidate,
    getBus: () => getBus(sessionId),
  });

  const allTools = [...toolkit.tools, repairTool, restartTool, rollbackTool];

  const graph = createAgent({
    model: model.model,
    tools: allTools,
    stateSchema: SimAssistantState,
    checkpointer: assistantCheckpointer,
    middleware: [
      dynamicSystemPromptMiddleware((state) => {
        const manifest = (state as SimAssistantStateType).manifest ?? "";
        return buildSystemPrompt(manifest);
      }),
    ],
    name: "sim-assistant",
  });

  return { graph, toolkit };
}
