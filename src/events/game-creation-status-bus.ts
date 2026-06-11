import { EventEmitter } from 'events';

export type ArtifactName = 'stateSchema' | 'actionDefinitions' | 'transitions' | 'instructions' | 'generatedMechanics' | 'producedTokens' | 'coherenceCheck';
export type RepairTarget = 'transitions' | 'instructions' | 'coherence';

export type GameCreationStatusEvent =
  | { type: 'spec:started' }
  | { type: 'spec:completed' }
  | { type: 'spec:error'; error: string }
  | { type: 'artifact:started'; artifact: ArtifactName; current?: number; total?: number }
  | { type: 'artifact:completed'; artifact: ArtifactName; total?: number }
  | { type: 'artifact:error'; artifact: ArtifactName; error: string }
  | { type: 'repair:started'; target: RepairTarget }
  | { type: 'repair:completed'; target: RepairTarget }
  | { type: 'generation:started' }
  | { type: 'generation:completed' }
  | { type: 'generation:error'; error: string };

export interface GameCreationBus {
  emit(event: GameCreationStatusEvent): void;
  on(handler: (event: GameCreationStatusEvent) => void): void;
  off(handler: (event: GameCreationStatusEvent) => void): void;
}

const EVENT_KEY = 'status';
const busMap = new Map<string, EventEmitter>();
const specInProgressMap = new Map<string, boolean>();
const generationInProgressMap = new Map<string, boolean>();
const lastTerminalEventMap = new Map<string, GameCreationStatusEvent>();
/** Most recent artifact:started or repair:started event — replayed to late-connecting clients. */
const currentStepEventMap = new Map<string, GameCreationStatusEvent>();

function makeInterface(emitter: EventEmitter, gameId: string): GameCreationBus {
  return {
    emit(event) {
      // Auto-track current step for catch-up replays
      if (event.type === 'artifact:started' || event.type === 'repair:started') {
        currentStepEventMap.set(gameId, event);
      } else if (event.type === 'generation:completed' || event.type === 'generation:error') {
        currentStepEventMap.delete(gameId);
      }
      emitter.emit(EVENT_KEY, event);
    },
    on(handler) { emitter.on(EVENT_KEY, handler); },
    off(handler) { emitter.off(EVENT_KEY, handler); },
  };
}

/**
 * Returns the bus for the given gameId, or undefined if none exists.
 * Use in workflow code — only emits if an SSE subscriber is already listening.
 */
export function getBus(gameId: string): GameCreationBus | undefined {
  const emitter = busMap.get(gameId);
  return emitter ? makeInterface(emitter, gameId) : undefined;
}

/**
 * Returns the bus for the given gameId, creating one if it doesn't exist.
 * Call from the SSE handler before the client starts listening.
 * If a spec generation is already in progress, emits a catch-up spec:started event.
 */
export function getOrCreateBus(gameId: string): GameCreationBus {
  let emitter = busMap.get(gameId);
  if (!emitter) {
    emitter = new EventEmitter();
    emitter.setMaxListeners(20);
    busMap.set(gameId, emitter);
  }
  const bus = makeInterface(emitter, gameId);
  // Send catch-up events so late-connecting SSE clients know what's underway
  if (generationInProgressMap.get(gameId)) {
    // Replay the most recent step event if available, otherwise just generation:started
    const currentStep = currentStepEventMap.get(gameId);
    if (currentStep) {
      queueMicrotask(() => bus.emit(currentStep));
    } else {
      queueMicrotask(() => bus.emit({ type: 'generation:started' }));
    }
  } else if (specInProgressMap.get(gameId)) {
    queueMicrotask(() => bus.emit({ type: 'spec:started' }));
  } else {
    // Generation already finished — replay the terminal event so the client
    // knows the outcome immediately rather than waiting in silence.
    const terminal = lastTerminalEventMap.get(gameId);
    if (terminal) {
      queueMicrotask(() => bus.emit(terminal));
    }
  }
  return bus;
}

/**
 * Removes the bus entry for the given gameId.
 */
export function removeBus(gameId: string): void {
  busMap.delete(gameId);
  generationInProgressMap.delete(gameId);
  lastTerminalEventMap.delete(gameId);
  currentStepEventMap.delete(gameId);
}

// ─── Spec-in-progress guard ─────────────────────────────────────────────────

/**
 * Marks a spec generation as in-progress for the given gameId.
 */
export function setSpecInProgress(gameId: string): void {
  specInProgressMap.set(gameId, true);
}

/**
 * Clears the in-progress flag for the given gameId.
 */
export function clearSpecInProgress(gameId: string): void {
  specInProgressMap.delete(gameId);
}

export function setGenerationInProgress(gameId: string): void {
  generationInProgressMap.set(gameId, true);
}

export function clearGenerationInProgress(gameId: string, terminal?: GameCreationStatusEvent): void {
  generationInProgressMap.delete(gameId);
  currentStepEventMap.delete(gameId);
  if (terminal) {
    lastTerminalEventMap.set(gameId, terminal);
  }
}

/**
 * Returns whether a spec generation is currently in-progress for the given gameId.
 */
export function isSpecInProgress(gameId: string): boolean {
  return specInProgressMap.get(gameId) === true;
}
