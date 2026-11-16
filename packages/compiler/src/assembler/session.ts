// ---------------------------------------------------------------------------
// assembleSession — top-level Phase 2 entry point
//
// Composes assembleConfig + assembleInitialState into a createSession
// factory matching the shape CompiledGameModule.createSession expects.
// ---------------------------------------------------------------------------

import type { ModularGameSpec } from "@chaincraft/gamedef";
import type { CreateSessionOptions } from "@chaincraft/runtime";
import {
  createSeededRng,
  EffectBus,
  GameEventEmitter,
  PassiveActivation,
  EffectRegistration,
  registerPassiveActivations,
} from "@chaincraft/runtime";
import { assembleConfig } from "#compiler/assembler/config.js";
import { assembleInitialState } from "#compiler/assembler/state.js";
import type { GameSession, GameConfig } from "#compiler/assembler/types.js";

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (Math.imul(31, hash) + input.charCodeAt(i)) | 0;
  }
  return hash;
}

/** Seed derived from the game id; `options.seed` overrides it (tests, playtest, replay). */
export function resolveSeed(gameId: string): number {
  return hashString(gameId);
}

export interface AssembledSessionFactory {
  config: GameConfig;
  createSession: (
    gameId: string,
    players: string[],
    options?: CreateSessionOptions,
  ) => GameSession;
}

/**
 * Assemble the static-data portion of a compiled game module: the immutable
 * GameConfig and a createSession factory that produces a fresh session with
 * catalog pieces in game:unassigned, empty declared inventories, and
 * default-valued properties. Setup effects (onEnter hooks) do the rest once
 * the flow runner starts — this assembler does not run any effects.
 */
export function assembleSession(
  spec: ModularGameSpec,
  specId: string,
  passiveActivations: PassiveActivation[] = [],
  effects: Record<string, EffectRegistration> = {},
): AssembledSessionFactory {
  const config = assembleConfig(spec);

  const createSession = (
    gameId: string,
    players: string[],
    options?: CreateSessionOptions,
  ): GameSession => {
    const bus = new EffectBus();
    const session: GameSession = {
      gameId,
      specId,
      config,
      state: assembleInitialState(spec, config, players),
      players,
      outbox: [],
      rng: createSeededRng(
        options?.seed ?? resolveSeed(gameId),
      ),
      events: new GameEventEmitter(),
      bus,
      _inventoryCache: new Map(),
    };
    registerPassiveActivations(bus, passiveActivations, session, effects);
    return session;
  };

  return {
    config,
    createSession,
  };
}
