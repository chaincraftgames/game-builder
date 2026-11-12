// ---------------------------------------------------------------------------
// Playtest runs and repro tokens.
//
// A game is identified by (base seed, player count, index). Both of its seeds are derived from
// that triple, so the token `p<players>-s<seed>-g<index>` is enough to replay it.
// ---------------------------------------------------------------------------

import type { CompiledGameModule } from "@chaincraft/runtime";
import type { PlayedGame } from "#authoring/tools/playtest/checks.js";
import { playGame } from "#authoring/tools/playtest/driver.js";

/** Identifies one game of a run. `index` counts from 0 within its player count. */
export interface ReplayId {
  seed: number;
  playerCount: number;
  index: number;
}

/** Options for {@link playOne} and {@link playRun}; `maxDecisions` must match for a faithful replay. */
export interface PlayOptions {
  maxDecisions: number;
}

/** Options for {@link playRun}. */
export interface RunOptions extends PlayOptions {
  seed: number;
  /** Games per player count. */
  games: number;
  playerCounts: number[];
}

const GAME_SALT = 0x67616d65;
const POLICY_SALT = 0x706f6c69;

/** A 32-bit mix of (salt, seed, playerCount, index); each salt gives an independent stream. */
function derive(salt: number, id: ReplayId): number {
  let h = 0x811c9dc5 ^ salt;
  for (const part of [id.seed, id.playerCount, id.index]) {
    h = Math.imul(h ^ (part | 0), 0x01000193);
    h ^= h >>> 15;
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Seed for the game's own RNG (shuffles, dice). */
export const gameSeedFor = (id: ReplayId): number => derive(GAME_SALT, id);

/** Seed for the random player, independent of the game RNG. */
export const policySeedFor = (id: ReplayId): number => derive(POLICY_SALT, id);

/** `p<players>-s<seed>-g<index>`. */
export const formatRepro = (id: ReplayId): string =>
  `p${id.playerCount}-s${id.seed}-g${id.index}`;

/** The inverse of {@link formatRepro}; `null` when the token is malformed. */
export function parseRepro(token: string): ReplayId | null {
  const match = /^p(\d+)-s(\d+)-g(\d+)$/.exec(token.trim());
  if (!match) return null;
  const [playerCount, seed, index] = match.slice(1).map(Number);
  if (
    ![playerCount, seed, index].every(Number.isSafeInteger) ||
    playerCount < 1
  )
    return null;
  return { playerCount, seed, index };
}

/** Player ids in seat order: `p1..pN`. */
export const playerIdsFor = (playerCount: number): string[] =>
  Array.from({ length: playerCount }, (_, i) => `p${i + 1}`);

/** Plays the one game the id names. */
export async function playOne(
  module: CompiledGameModule,
  id: ReplayId,
  options: PlayOptions,
): Promise<PlayedGame> {
  const result = await playGame({
    module,
    players: playerIdsFor(id.playerCount),
    gameSeed: gameSeedFor(id),
    policySeed: policySeedFor(id),
    maxDecisions: options.maxDecisions,
  });
  return { playerCount: id.playerCount, index: id.index, result };
}

/** Plays `games` games for each player count, in order. */
export async function playRun(
  module: CompiledGameModule,
  options: RunOptions,
): Promise<PlayedGame[]> {
  const played: PlayedGame[] = [];
  for (const playerCount of options.playerCounts) {
    for (let index = 0; index < options.games; index++) {
      played.push(
        await playOne(
          module,
          { seed: options.seed, playerCount, index },
          options,
        ),
      );
    }
  }
  return played;
}
