# Sim Assistant — Design Document

## Overview

The Sim Assistant is a conversational AI agent that helps game creators understand, diagnose, and fix simulation behavior. It operates as **caller #3** for the artifact editor graph (alongside spec-processing repair and the future design agent handoff).

The creator can interact with the sim assistant at any point before, during, or after a simulation run.

## Capabilities

### V1

| Capability | Description |
|---|---|
| **Explain behavior** | Answer "why did X happen?" by retrieving mechanic code, instructions, and before/after state snapshots from recent checkpoints |
| **Diagnose issues** | Identify root cause: code bug, instruction gap, schema gap, or design issue |
| **Repair artifacts** | On creator confirmation, invoke the artifact editor graph to fix instructions/mechanics/schema |
| **Restart simulation** | After repair, reset the runtime graph and re-initialize from corrected artifacts (no spec-processing re-run) |
| **Block published edits** | If artifacts are published, redirect creator to design workflow for versioning |

### Future

| Capability | Description |
|---|---|
| **Design agent handoff** | Pass structured diagnosis to design agent for spec-level changes |
| **Checkpoint replay** | Replay simulation from a specific checkpoint before anomalous behavior |
| **Transition rationale capture** | Persist executor reasoning per transition for richer diagnosis |
| **Persistent history** | Store-backed conversation history across page refreshes |
| **Mechanic scoping** | `mechanicsToReview` filter on coordinator to limit context for large games |

## Architecture

### Graph Structure

```
POST /api/simulate/:sessionId/assistant/message
  → simAssistantGraph.stream(userMessage, config)

┌──────────────────────────────────────────────────────────────┐
│  Sim Assistant Graph (ReAct pattern)                         │
│                                                              │
│  START → agent_node ←→ tool_node → response_node → END      │
│              │              │                                │
│              │         [retrieval tools]                      │
│              │         - getGameSpec                          │
│              │         - getArtifact                          │
│              │         - getMechanicCode                      │
│              │         - getRecentStates                      │
│              │         - getActionLog                         │
│              │                                                │
│              │         [action tools]                         │
│              │         - repairArtifacts                      │
│              │         - restartSimulation                    │
│              └────────────────────────────────────────────────┘
```

The agent_node runs the LLM with bound tools. The tool_node executes tool calls. The loop continues until the LLM produces a final response without tool calls, which flows to response_node and END.

### SSE Event Streaming

Follows the existing `GameCreationBus` pattern from `src/events/game-creation-status-bus.ts`:

```
Frontend connects:  GET  /api/simulate/:sessionId/assistant/stream
Frontend sends:     POST /api/simulate/:sessionId/assistant/message

SSE event flow:
  → { type: "connected", sessionId }
  → { type: "message", content: "Looking at the mechanic..." }   // streamed tokens
  → { type: "repair:started", description: "Patching instructions..." }
  → { type: "repair:progress", step: "Regenerating mechanic..." }
  → { type: "repair:completed", summary: "Fixed tie handling in resolve_round_outcome" }
  → { type: "message:complete", content: "..." }                 // full final response
```

**Event bus**: `SimAssistantBus` per sessionId, same `EventEmitter` wrapper.

**Event types**:

```typescript
type RepairOperation = 'patch' | 'reextract';

type SimAssistantEvent =
  | { type: 'connected'; sessionId: string }
  | { type: 'message'; content: string }           // streamed response tokens
  | { type: 'message:complete'; content: string }   // full final response
  | { type: 'repair:started'; description: string }
  | { type: 'repair:progress'; step: string; operation?: RepairOperation; artifact?: string }
  | { type: 'repair:completed'; summary: string }
  | { type: 'repair:error'; error: string }
  | { type: 'error'; error: string };
```

### Endpoint: SSE Stream

```
GET /api/simulate/:sessionId/assistant/stream

Same pattern as src/api/create/routes.ts:
  → reply.hijack()
  → reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', ... })
  → bus.on(send)
  → request.raw.once('close', cleanup)
```

### Endpoint: Send Message

```
POST /api/simulate/:sessionId/assistant/message

Body: { message: string }
Response: 202 Accepted (results delivered via SSE)

Internally:
  1. Get or create SimAssistantBus for sessionId
  2. Build/resume conversation state
  3. Invoke simAssistantGraph.stream() in background
  4. Graph emits events to bus as it progresses
```

## Context Management

### System Prompt Manifest

A lightweight structural manifest injected into the system prompt (~300-500 tokens). Gives the LLM enough context to formulate targeted tool calls. Built from a single `getTuple()` call on the latest runtime checkpoint — no history iteration. The agent fetches action history on demand via retrieval tools.

```
Game: "Weapon Inventor" (2 players)
Phases: init → weapon_setup → round_start → weapon_selection → round_resolution → match_check → finished
Transitions: 7 (initialize_game, both_weapons_ready, begin_round, both_weapons_submitted, resolve_round_outcome, player_wins_match, continue_to_next_round)
Mechanics: 2 (resolve_round_outcome, both_weapons_ready)
Sim status: running
Current phase: round_resolution
```

### Retrieval Tools

All tools read from the **runtime graph's checkpoints** via the session's `SqliteSaver`/`PostgresSaver`. They are closures over the checkpointer and sessionId — simple checkpoint lookups, no LLM intermediary.

| Tool | Input | Returns |
|---|---|---|
| `getGameSpec` | none | Full game specification text |
| `getArtifact` | `{ type: 'schema' \| 'transitions' \| 'instructions', id?: string }` | Full artifact or specific fragment by ID |
| `getMechanicCode` | `{ mechanicId: string }` | TypeScript source code + associated mechanicsGuidance |
| `getRecentStates` | `{ count?: number }` | Last N game + player state snapshots from checkpoint history (default 5). Each entry includes phase, gameState, and the action that triggered it. The assistant can call again with a larger count to look further back. |
| `getActionLog` | `{ playerId?: string, lastN?: number }` | Filtered action history from recent checkpoints |

### What the LLM Does NOT See by Default

- Full artifact JSON (fetched on demand via tools)
- Full state history (fetched by step range)
- Mechanic source code (fetched by ID)
- Game spec (fetched on demand)

This keeps the base prompt small and the LLM in control of what context it needs.

## Conversation Flow

### Diagnosis Pattern

```
Creator: "Player 2 won the round even though both chose rock"

Assistant (internal):
  → calls getMechanicCode("resolve_round_outcome")
  → calls getRecentStates(5)   // last 5 state snapshots including before/after the bad transition

Assistant (to creator):
  "The `resolve_round_outcome` mechanic doesn't handle ties. When both
   weapons map to the same RPS type, the code falls through to the else
   branch on line 22 and awards player2 the win. This happens because the
   `mechanicsGuidance.computation` says 'determine winner' without
   specifying tie handling — the rules mention ties but the computation
   doesn't operationalize it.

   I'd fix the instruction to include explicit tie detection, then
   regenerate the mechanic. Want me to proceed?"
```

Tool calls are invisible to the creator. Sources are cited in the response.

### Repair Pattern

```
Creator: "Yes, fix it"

SSE events:
  → { type: "repair:started", description: "Fixing tie handling in resolve_round_outcome" }
  → { type: "repair:progress", step: "Coordinator: patching instructions (computation field)", operation: "patch", artifact: "instructions" }
  → { type: "repair:progress", step: "Regenerating mechanic from updated instructions", operation: "reextract", artifact: "mechanics" }
  → { type: "repair:progress", step: "tsc validation passed" }
  → { type: "repair:completed", summary: "Patched instructions + regenerated mechanic" }

Assistant (to creator):
  "Done. I updated the instructions to specify tie handling ('if both
   weapons map to the same RPS type, skip scoring and report tie') and
   regenerated the mechanic. The new code correctly checks for ties
   before determining a winner. Ready to restart the simulation?"
```

### Repair Bridge (error formulation)

The sim assistant translates conversational diagnosis into the structured error format the artifact editor coordinator expects. This is the key bridging logic:

```typescript
// The sim assistant formulates this from the conversation:
const errors = [
  'Mechanic "resolve_round_outcome" incorrectly awards a point when ' +
  'both weapons map to the same RPS type (tie). The mechanicsGuidance ' +
  'computation says "determine winner" without specifying tie handling.'
];

// Then invokes the artifact editor graph:
const result = await artifactEditorGraph.invoke({
  gameSpecification,
  errors,
  schemaFields,
  stateSchema, stateTransitions,
  playerPhaseInstructions, transitionInstructions,
  generatedMechanics, stateInterfaces,
});
```

The `repairArtifacts` tool wraps this: it loads current artifacts from the **runtime graph's latest checkpoint**, adds the formulated error, and calls the editor graph.

## Conversation State

Follows the same pattern as the design conversation (`src/ai/design/`):

1. **LangGraph checkpointer**: Graph compiled with `SqliteSaver` or `PostgresSaver` (via `getSaver(sessionId, 'sim-assistant')`). Messages accumulate in checkpoints across invocations automatically.
2. **GraphCache**: Compiled graph instances cached in an LRU `GraphCache` keyed by `sessionId`. Cache eviction doesn't lose state — checkpointed data persists in the database.
3. **thread_id = sessionId**: Each `graph.stream()` call passes `{ configurable: { thread_id: sessionId } }`. The checkpointer loads prior messages, the reducer appends the new message.
4. **Messages reducer**: Appends new messages, filters system messages, caps at a reasonable limit.

```typescript
SimAssistantState = Annotation.Root({
  // Conversation (accumulated via checkpointer across invocations)
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => {
      const combined = [...x, ...y];
      return combined.filter(msg => msg.type !== 'system').slice(-50);
    },
  }),

  // Session context (set once at graph creation, read-only)
  sessionId: Annotation<string>(),
  gameId: Annotation<string>(),

  // Manifest (rebuilt before each invocation from runtime checkpoint)
  manifest: Annotation<string>(),
});
```

### Future: Persistent across page refreshes

V1 conversation survives as long as the checkpointer's backing store is alive (SQLite file or Postgres rows). A future enhancement would add explicit session resume from the frontend after page refresh, loading the last checkpoint for the thread.

## Published Artifact Guard

### V1: Block editing

Before invoking repair, the `repairArtifacts` tool checks if the game has published artifacts:

```typescript
if (game.publishedVersion) {
  return {
    blocked: true,
    reason: "These artifacts are published to live games. To make changes, " +
            "create a new version in the design workflow. Here's what needs " +
            "to change: [diagnosis summary]"
  };
}
```

The sim assistant surfaces this to the creator and offers to summarize the needed changes for the design workflow.

### Future: Auto-versioning

- Every artifact edit creates a new version number (monotonic integer)
- Published games pin to a version
- New publishes require explicit promotion
- Spec-processing checkpoints serve as version snapshots

## File Structure

### game-builder (backend)

```
src/
  ai/
    simulate/
      graphs/
        sim-assistant-graph/
          index.ts                   # Graph definition (ReAct agent)
          sim-assistant-state.ts     # Annotation.Root state
          tools.ts                   # Retrieval + action tool definitions
          prompts.ts                 # System prompt + manifest builder
          repair-bridge.ts           # Error formulation for artifact editor
  api/
    simulate/
      assistant/
        routes.ts                    # SSE + message endpoints
        handler.ts                   # Request handling
  events/
    sim-assistant-bus.ts             # SSE event bus (follows game-creation-status-bus pattern)
```

### chaincraft-orchestrator (proxy)

```
src/
  modules/
    simulation/
      simulation.routes.ts           # Add assistant proxy routes
      simulation-service.ts          # Add assistant methods
  infrastructure/
    game-builder/
      client.ts                      # Add assistant API methods
```

### chaincraft-frontend (UI — already mocked)

The frontend UI is already built with a hardcoded stub backend. Files to update:

```
src/
  contexts/
    simulation/
      AssistantContext.tsx            # Replace stub with real API + SSE
  hooks/
    simulation/
      useAssistantStream.ts          # NEW: SSE EventSource hook
```

**Existing UI components (no changes needed):**
- `SimulationChat.tsx` — dual-mode chat (player/assistant), renders assistant messages
- `PlayersBar.tsx` — toggle button (Sim Assistant / sparkle icon)
- `SessionContext.tsx` — `activeView: "player" | "assistant"` state
- `AssistantContext.tsx` — `AssistantMessage` type, `sendAssistantMessage()`, `isAssistantLoading` (wiring exists, just needs real backend)

## Dependencies

| Component | Status | Notes |
|---|---|---|
| Artifact editor graph | ✅ Complete | Full coordinator-driven repair with mechanics |
| Coordinator with mechanics | ✅ Complete | Patterns 11-13, upstream-first principle |
| Edit mechanics node | ✅ Complete | Patch, reextract, cascade detection |
| Revalidate with tsc | ✅ Complete | Layer 3 validation |
| SSE infrastructure | ✅ Exists | `game-creation-status-bus.ts` pattern to copy |
| Runtime checkpoint access | ✅ Exists | `SqliteSaver`/`PostgresSaver` via `getSaver()`, `saver.list()` for history |
| GraphCache | ✅ Exists | LRU graph cache pattern from design workflow |
| Sim restart | ⚠️ Needs work | Need to reset runtime graph + call `initializeSimulation()` with repaired artifacts (no spec-processing re-run) |

## Implementation Order

### Phase 1: Backend Core (game-builder)
1. **Event bus** — `SimAssistantBus` (copy pattern from `game-creation-status-bus.ts`)
2. **State + manifest** — `SimAssistantState`, manifest builder from runtime checkpoint
3. **Retrieval tools** — `getGameSpec`, `getArtifact`, `getMechanicCode`, `getRecentStates`, `getActionLog` (closures over runtime checkpointer)
4. **Graph** — `createSimAssistantGraph()` with ReAct agent + tools (diagnosis only, no repair yet)
5. **Routes** — `GET .../assistant/stream` (SSE) + `POST .../assistant/message` (202 → background invoke)
6. **Unit test** — Diagnosis flow: send message → tool calls → response

### Phase 2: Repair + Restart (game-builder)
7. **Repair bridge** — `repairArtifacts` tool: error formulation + artifact editor invocation
8. **Restart tool** — `restartSimulation`: reset runtime graph + re-initialize with repaired artifacts
9. **Integration test** — End-to-end: message → diagnose → repair → restart → verify

### Phase 3: Frontend Wiring
10. **Orchestrator proxy** — Add assistant routes to `simulation.routes.ts`, service methods, and `GameBuilderClient` methods
11. **SSE hook** — `useAssistantStream.ts`: `EventSource` connection to orchestrator SSE endpoint, handles `message`, `repair:*`, `error` events
12. **AssistantContext** — Replace stub `sendAssistantMessage()` with real API call + SSE streaming. Map SSE events to `AssistantMessage[]` state. Handle `repair:started/progress/completed` as system messages in the chat.
13. **End-to-end test** — Frontend → orchestrator → game-builder → response via SSE
