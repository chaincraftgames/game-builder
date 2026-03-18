import { EventEmitter } from 'events';

export type ArtifactName = 'stateSchema' | 'transitions' | 'instructions' | 'producedTokens';
export type RepairTarget = 'transitions' | 'instructions';

export type GameCreationStatusEvent =
  | { type: 'spec:started' }
  | { type: 'spec:completed' }
  | { type: 'spec:error'; error: string }
  | { type: 'artifact:started'; artifact: ArtifactName }
  | { type: 'artifact:completed'; artifact: ArtifactName }
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

function makeInterface(emitter: EventEmitter): GameCreationBus {
  return {
    emit(event) { emitter.emit(EVENT_KEY, event); },
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
  return emitter ? makeInterface(emitter) : undefined;
}

/**
 * Returns the bus for the given gameId, creating one if it doesn't exist.
 * Call from the SSE handler before the client starts listening.
 */
export function getOrCreateBus(gameId: string): GameCreationBus {
  let emitter = busMap.get(gameId);
  if (!emitter) {
    emitter = new EventEmitter();
    emitter.setMaxListeners(20);
    busMap.set(gameId, emitter);
  }
  return makeInterface(emitter);
}

/**
 * Removes the bus entry for the given gameId.
 */
export function removeBus(gameId: string): void {
  busMap.delete(gameId);
}
