import { EventEmitter } from 'events';

/** Whether the artifact editor is patching (error-context fix) or fully regenerating an artifact. */
export type RepairOperation = 'patch' | 'reextract';

/**
 * Union of all events emitted on the sim assistant SSE bus.
 *
 * - `connected` — Sent immediately when the SSE stream is established.
 * - `message` — Streamed response tokens from the assistant (incremental).
 * - `message:complete` — Full final response after streaming finishes.
 * - `repair:started` — The artifact editor has been invoked.
 * - `repair:progress` — Progress update during repair. Optional `operation` and `artifact`
 *   indicate whether a patch or reextract is happening on a specific artifact.
 * - `repair:completed` — Repair finished successfully.
 * - `repair:error` — Repair failed.
 * - `error` — General error (graph failure, timeout, etc.).
 */
export type SimAssistantEvent =
  | { type: 'connected'; sessionId: string }
  | { type: 'message'; content: string }
  | { type: 'message:complete'; content: string }
  | { type: 'repair:started'; description: string }
  | { type: 'repair:progress'; step: string; operation?: RepairOperation; artifact?: string }
  | { type: 'repair:completed'; summary: string }
  | { type: 'repair:error'; error: string }
  | { type: 'game:restart'; publicMessage?: string; playerStates?: Record<string, { privateMessage?: string }> }
  | { type: 'error'; error: string };

/**
 * Typed event bus for a single sim assistant session.
 * Wraps an {@link EventEmitter} with a single event key so consumers
 * only deal with {@link SimAssistantEvent} values.
 */
export interface SimAssistantBus {
  /** Emit an event to all SSE subscribers for this session. */
  emit(event: SimAssistantEvent): void;
  /** Subscribe to events for this session. */
  on(handler: (event: SimAssistantEvent) => void): void;
  /** Unsubscribe a previously registered handler. */
  off(handler: (event: SimAssistantEvent) => void): void;
}

const EVENT_KEY = 'assistant';
const busMap = new Map<string, EventEmitter>();

// ─── SSE Event Buffer (for Last-Event-ID replay) ─────────────────────────────

interface BufferedEvent {
  id: number;
  event: SimAssistantEvent;
}

const eventBuffers = new Map<string, BufferedEvent[]>();
const eventCounters = new Map<string, number>();
const MAX_BUFFER_SIZE = 30;

/**
 * Appends an event to the per-session buffer and returns its sequential ID.
 * Only the last MAX_BUFFER_SIZE events are retained.
 */
export function appendBufferedEvent(sessionId: string, event: SimAssistantEvent): number {
  const id = (eventCounters.get(sessionId) ?? 0) + 1;
  eventCounters.set(sessionId, id);

  const buffer = eventBuffers.get(sessionId) ?? [];
  buffer.push({ id, event });
  if (buffer.length > MAX_BUFFER_SIZE) buffer.shift();
  eventBuffers.set(sessionId, buffer);

  return id;
}

/**
 * Returns all buffered events with id > afterId for the given session.
 * Used by the SSE route to replay missed events on reconnect.
 */
export function getBufferedEventsSince(sessionId: string, afterId: number): BufferedEvent[] {
  const buffer = eventBuffers.get(sessionId) ?? [];
  return buffer.filter(e => e.id > afterId);
}

// ─────────────────────────────────────────────────────────────────────────────

function makeInterface(emitter: EventEmitter): SimAssistantBus {
  return {
    emit(event) { emitter.emit(EVENT_KEY, event); },
    on(handler) { emitter.on(EVENT_KEY, handler); },
    off(handler) { emitter.off(EVENT_KEY, handler); },
  };
}

/**
 * Returns the bus for the given sessionId, or undefined if none exists.
 * Use in graph/workflow code — only emits if an SSE subscriber is already listening.
 */
export function getBus(sessionId: string): SimAssistantBus | undefined {
  const emitter = busMap.get(sessionId);
  return emitter ? makeInterface(emitter) : undefined;
}

/**
 * Returns the bus for the given sessionId, creating one if it doesn't exist.
 * Call from the SSE handler before the client starts listening.
 */
export function getOrCreateBus(sessionId: string): SimAssistantBus {
  let emitter = busMap.get(sessionId);
  if (!emitter) {
    emitter = new EventEmitter();
    emitter.setMaxListeners(20);
    busMap.set(sessionId, emitter);
  }
  return makeInterface(emitter);
}

/**
 * Removes the bus entry for the given sessionId.
 */
export function removeBus(sessionId: string): void {
  busMap.delete(sessionId);
  eventBuffers.delete(sessionId);
  eventCounters.delete(sessionId);
}
