# Sim Assistant — Design Document

## Overview

The Sim Assistant is a conversational AI agent that helps game creators understand, diagnose, and fix simulation behavior. It operates as **caller #3** for the artifact editor graph (alongside spec-processing repair and the future design agent handoff).

The creator can interact with the sim assistant at any point before, during, or after a simulation run.

## Capabilities

### V1

| Capability | Description |
|---|---|
| **Explain behavior** | Answer "why did X happen?" by retrieving relevant artifacts, state history, and transition rationale |
| **Diagnose issues** | Identify root cause: code bug, instruction gap, schema gap, or design issue |
| **Repair artifacts** | On creator confirmation, invoke the artifact editor graph to fix instructions/mechanics/schema |
| **Restart simulation** | After repair, start a fresh simulation with corrected artifacts |
| **Block published edits** | If artifacts are published, redirect creator to design workflow for versioning |

### Future

| Capability | Description |
|---|---|
| **Design agent handoff** | Pass structured diagnosis to design agent for spec-level changes |
| **Checkpoint replay** | Replay simulation from the last checkpoint before anomalous behavior |
| **Persistent history** | Store-backed conversation history across sessions |
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
│              │         - getStateAtStep                       │
│              │         - getTransitionRationale               │
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
type SimAssistantEvent =
  | { type: 'connected'; sessionId: string }
  | { type: 'message'; content: string }           // streamed response tokens
  | { type: 'message:complete'; content: string }   // full final response
  | { type: 'repair:started'; description: string }
  | { type: 'repair:progress'; step: string }
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

A lightweight structural manifest injected into the system prompt (~300-500 tokens). Gives the LLM enough context to formulate targeted tool calls:

```
Game: "Weapon Inventor" (2 players)
Phases: init → weapon_setup → round_start → weapon_selection → round_resolution → match_check → finished
Transitions: 7 (initialize_game, both_weapons_ready, begin_round, both_weapons_submitted, resolve_round_outcome, player_wins_match, continue_to_next_round)
Mechanics: 2 (resolve_round_outcome, both_weapons_ready)
Sim status: running | completed | error
Current step: 12 (phase: round_resolution, round 2)
Last 3 actions: [player1: select_weapon "Banana Launcher", player2: select_weapon "Rubber Duck", auto: both_weapons_submitted]
```

### Retrieval Tools

All tools are closures over the session's store — simple key lookups, no LLM intermediary.

| Tool | Input | Returns |
|---|---|---|
| `getGameSpec` | none | Full game specification text |
| `getArtifact` | `{ type: 'schema' \| 'transitions' \| 'instructions', id?: string }` | Full artifact or specific fragment by ID |
| `getMechanicCode` | `{ mechanicId: string }` | TypeScript source code + associated mechanicsGuidance |
| `getStateAtStep` | `{ step: number }` | Game + player state snapshot from checkpoint |
| `getTransitionRationale` | `{ transitionId: string, step?: number }` | The LLM executor's reasoning for a specific state change |
| `getActionLog` | `{ playerId?: string, fromStep?: number, toStep?: number }` | Filtered action history |

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
  → calls getTransitionRationale("resolve_round_outcome", step=8)
  → calls getMechanicCode("resolve_round_outcome")
  → calls getStateAtStep(7)  // before the transition
  → calls getStateAtStep(8)  // after the transition

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
  → { type: "repair:progress", step: "Coordinator: patching instructions (computation field)" }
  → { type: "repair:progress", step: "Regenerating mechanic from updated instructions" }
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

The `repairArtifacts` tool wraps this: it gathers current artifacts from the store, adds the formulated error, and calls the editor graph.

## Conversation State

### V1: Ephemeral

Message history is held in-memory for the duration of the session. Stored as a `BaseMessage[]` array in the graph state, following the standard LangGraph chat pattern.

The sim assistant graph state:

```typescript
SimAssistantState = Annotation.Root({
  // Conversation
  messages: Annotation<BaseMessage[]>({ reducer: messagesReducer }),

  // Session context (set once at graph creation, read-only)
  sessionId: Annotation<string>(),
  gameId: Annotation<string>(),

  // Manifest (rebuilt before each invocation from store)
  manifest: Annotation<string>(),
});
```

Conversation history is lost when the session ends. Changes made via the repair tool persist in the store.

### Future: Persistent

Store-backed message history, loadable across sessions. Enables "pick up where we left off" after page refresh.

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

```
src/
  ai/
    simulate/
      sim-assistant/
        sim-assistant-graph.ts       # Graph definition (ReAct agent)
        sim-assistant-state.ts       # Annotation.Root state
        tools.ts                     # Retrieval + action tool definitions
        prompts.ts                   # System prompt + manifest builder
        repair-bridge.ts             # Error formulation for artifact editor
  api/
    simulate/
      assistant/
        routes.ts                    # SSE + message endpoints
        handler.ts                   # Request handling
  events/
    sim-assistant-bus.ts             # SSE event bus (follows game-creation-status-bus pattern)
```

## Dependencies

| Component | Status | Notes |
|---|---|---|
| Artifact editor graph | ✅ Complete | Tasks 1-8 done, tested |
| Coordinator with mechanics | ✅ Complete | 3 scenarios passing |
| Edit mechanics node | ✅ Complete | Patch, reextract, cascade |
| Revalidate with tsc | ✅ Complete | Layer 3 validation |
| SSE infrastructure | ✅ Exists | `game-creation-status-bus.ts` pattern |
| Store/checkpoint access | ✅ Exists | `InMemoryStore` + sqlite checkpointer |
| State history retrieval | ⚠️ Needs verification | Check what's captured in checkpoints |
| Transition rationale capture | ⚠️ Needs verification | Check if executor logs this to store |
| Sim restart API | ⚠️ May need work | Verify `createSimulation` can re-init with existing artifacts |

## Implementation Order

1. **Event bus** — `SimAssistantBus` (copy pattern from `game-creation-status-bus.ts`)
2. **Tools** — Retrieval tools (closures over store), verify data availability
3. **Graph** — `createSimAssistantGraph()` with ReAct agent + tools
4. **Repair bridge** — Error formulation + artifact editor invocation
5. **Routes** — SSE endpoint + message endpoint
6. **Integration test** — End-to-end: send message → diagnose → repair → verify fix
