import { flowNodePaths } from "@chaincraft/compiler";
import type { Diagnostic } from "#authoring/diagnostics.js";
import { readManifest } from "#authoring/project.js";
import { compile } from "#authoring/tools/compile.js";
import {
  buildReplayReport,
  buildReport,
  type PlaytestSummary,
} from "#authoring/tools/playtest/report.js";
import {
  parseRepro,
  playOne,
  playRun,
} from "#authoring/tools/playtest/run.js";

/** Default games per player count. */
export const DEFAULT_GAMES = 20;

/** Default base seed. */
export const DEFAULT_SEED = 1;

/** Default decision limit per game. */
export const DEFAULT_MAX_DECISIONS = 2000;

/** Largest `games` accepted. */
export const MAX_GAMES = 100;

/** Largest `maxDecisions` accepted. */
export const MAX_DECISIONS_LIMIT = 10_000;

/** Thrown for arguments that can't be honored; the CLI turns it into a usage error. */
export class PlaytestUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaytestUsageError";
  }
}

/** Options for {@link playtest}; every field has a default. */
export interface PlaytestOptions {
  /** Games per player count. */
  games?: number;
  seed?: number;
  /** Player counts to play; defaults to the spec's min and max. */
  playerCounts?: number[];
  maxDecisions?: number;
  /** A repro token; plays that one game and ignores `games`, `seed` and `playerCounts`. */
  replay?: string;
}

/** Outcome of {@link playtest}. */
export interface PlaytestResult {
  /** True when compile and the run have no errors; warnings and coverage don't count. */
  ok: boolean;
  /** Compile errors, or the run's errors then warnings. */
  diagnostics: Diagnostic[];
  /** Absent when the spec didn't compile. */
  summary?: PlaytestSummary;
  /** Present for a replay only. */
  replay?: { repro: string; transcript: string[] };
}

/**
 * Compiles the project at `root`, then plays seeded games with a random legal player.
 *
 * @param root - Project root containing `chaincraft.yaml`.
 * @throws {PlaytestUsageError} For a malformed replay token or a player count outside the spec's range.
 */
export async function playtest(
  root: string,
  options: PlaytestOptions = {},
): Promise<PlaytestResult> {
  const compiled = compile(root);
  if (!compiled.ok || !compiled.module || !compiled.spec) {
    return { ok: false, diagnostics: compiled.diagnostics };
  }
  const { module, spec } = compiled;
  // compile() requires the metadata module.
  const { min, max } = spec.metadata!.playerCount;
  const checkCount = (count: number) => {
    if (count < min || count > max)
      throw new PlaytestUsageError(
        `player count ${count} is outside the spec's range ${min}-${max}`,
      );
  };

  const specId = readManifest(root).id;
  const input = {
    spec,
    module,
    nodePaths: flowNodePaths(spec, specId),
    moduleFiles: compiled.moduleFiles,
  };
  const maxDecisions = options.maxDecisions ?? DEFAULT_MAX_DECISIONS;

  if (options.replay !== undefined) {
    const id = parseRepro(options.replay);
    if (id === null)
      throw new PlaytestUsageError(
        `malformed repro token "${options.replay}" (expected p<players>-s<seed>-g<index>, e.g. p2-s1-g0)`,
      );
    checkCount(id.playerCount);
    const game = await playOne(module, id, { maxDecisions });
    return buildReplayReport({ ...input, seed: id.seed, game });
  }

  const playerCounts = options.playerCounts ?? [...new Set([min, max])];
  playerCounts.forEach(checkCount);
  const seed = options.seed ?? DEFAULT_SEED;
  const games = await playRun(module, {
    seed,
    games: options.games ?? DEFAULT_GAMES,
    playerCounts,
    maxDecisions,
  });
  return buildReport({ ...input, seed, games });
}
