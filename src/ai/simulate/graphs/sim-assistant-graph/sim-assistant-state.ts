/**
 * Sim Assistant graph state definition.
 *
 * Follows the design conversation pattern: messages accumulate via the
 * LangGraph checkpointer across invocations, keyed by sessionId as thread_id.
 */
import { Annotation } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";

/**
 * Root state for the sim assistant ReAct agent graph.
 *
 * - `messages` — Conversation history, accumulated via checkpointer. Capped at 50.
 * - `sessionId` / `gameId` — Set once when the graph is created, read-only thereafter.
 * - `manifest` — Compact game summary rebuilt before each invocation from the
 *   runtime graph's latest checkpoint. Injected into the system prompt so the
 *   LLM can formulate targeted tool calls without fetching everything up front.
 */
export const SimAssistantState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => {
      const combined = [...x, ...y];
      return combined.filter(msg => msg.type !== 'system').slice(-50);
    },
    default: () => [],
  }),

  sessionId: Annotation<string>({
    reducer: (_old, next) => next,
    default: () => '',
  }),

  gameId: Annotation<string>({
    reducer: (_old, next) => next,
    default: () => '',
  }),

  manifest: Annotation<string>({
    reducer: (_old, next) => next,
    default: () => '',
  }),
});

export type SimAssistantStateType = typeof SimAssistantState.State;
