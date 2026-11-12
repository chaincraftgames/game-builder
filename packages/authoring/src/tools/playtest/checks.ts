// ---------------------------------------------------------------------------
// Playtest checks — turn played games into findings and coverage.
//
// Pure: no fs, no console. Errors are spec (or engine) problems the agent must act on; warnings
// are suspicious but legal; coverage is informational and never affects `ok` or the exit code.
// Findings carry a count and the first game that showed them; P3 turns that into a repro token.
// ---------------------------------------------------------------------------

import type { ModularGameSpec } from "@chaincraft/gamedef";
import type { CompiledGameModule } from "@chaincraft/runtime";
import type { PlaytestErrorCode } from "#authoring/tools/playtest/attribution.js";
import type {
  GameResult,
  TranscriptEntry,
} from "#authoring/tools/playtest/driver.js";

/**
 * A finding code represents a specific type of error or warning detected during
 * playtesting.
 */
export type FindingCode =
  | PlaytestErrorCode
  | "missing-catalog"
  | "playtest-no-end"
  | "playtest-ends-immediately"
  | "action-forfeit"
  | "fixed-outcome";

/** The severity of a finding: either an error or a warning. */
export type FindingSeverity = "error" | "warning";

/** One game of a run. `index` counts from 0 within its player count. */
export interface PlayedGame {
  playerCount: number;
  index: number;
  result: GameResult;
}

/** A finding represents an error or warning detected during playtesting. */
export interface Finding {
  code: FindingCode;
  severity: FindingSeverity;
  message: string;
  hint: string;
  /** Spec dot-path; absent when the origin is unknown. */
  path?: string;
  /** Games that showed it. */
  games: number;
  /** Games the rule was evaluated over (all games for errors, non-crashed for warnings). */
  total: number;
  /** First game that showed it; `null` for checks made before any game. */
  first: PlayedGame | null;
}

/** Coverage information for a playtest run. */
export interface Coverage {
  /** Non-crashed games the coverage was computed over. */
  games: number;
  /** Flow nodes never entered. */
  flowNodes: { nodeId: string; path: string }[];
  /** Actions never started; `offered` is how many prompts offered it (0 = never offered). */
  actions: { actionId: string; path: string; offered: number }[];
  /** Passives that never fired; `boundBy` are the catalog entry paths that bind each. */
  passives: { passiveId: string; boundBy: string[] }[];
}

/** Input for analyzing a playtest run. */
export interface RunInput {
  spec: ModularGameSpec;
  module: CompiledGameModule;
  /** Compiled flow node id → spec path, from the compiler's `flowNodePaths`. */
  nodePaths: Record<string, string>;
  games: PlayedGame[];
}

/** The result of analyzing a playtest run. */
export interface RunAnalysis {
  errors: Finding[];
  warnings: Finding[];
  /** `null` when every game crashed. */
  coverage: Coverage | null;
}

/** How many of the last decisions are inspected to locate the turn a game got stuck in. */
const NO_END_WINDOW = 100;

/**
 * The fixed-outcome warning needs at least this many completed games for one player count.
 * At 5, balanced examples fired by chance (P6 calibration); at 10 a 75% favourite still does ~6% of the time.
 */
const FIXED_OUTCOME_MIN_GAMES = 10;

/** The path to the win conditions in the game spec. */
const WIN_CONDITIONS_PATH = "flow.root.winConditions";

/** Base information for a finding, without the game-specific aggregation. */
type Base = Omit<Finding, "games" | "total" | "first">;

/** `missing-catalog`: gamepiece types are declared but no catalog creates any piece. */
export function missingCatalog(spec: ModularGameSpec): Finding | null {
  const hasTypes = (spec.gamepieceTypes?.types?.length ?? 0) > 0;
  if (!hasTypes || (spec.catalog?.entries?.length ?? 0) > 0) return null;
  return {
    code: "missing-catalog",
    severity: "error",
    message:
      "The spec declares gamepiece types but the catalog is missing or empty, so no pieces exist.",
    hint: "Add a catalog module with an entry for each piece (see `chaincraft docs schema catalog`).",
    path: "catalog",
    games: 0,
    total: 0,
    first: null,
  };
}

/** Aggregates the games of one run into deduplicated errors, warnings and coverage. */
export function analyzeRun(input: RunInput): RunAnalysis {
  const { spec, module, nodePaths, games } = input;
  const crashed = (game: PlayedGame) => game.result.end.kind === "error";
  const healthy = games.filter((game) => !crashed(game));

  const errors = new Map<string, Finding>();
  const warnings = new Map<string, Finding>();

  const catalog = missingCatalog(spec);
  if (catalog) errors.set(findingKey(catalog), catalog);

  for (const game of games) {
    merge(errors, game, gameErrors(game.result, spec, nodePaths), games.length);
  }
  for (const game of healthy) {
    merge(warnings, game, gameWarnings(game.result, spec), healthy.length);
  }
  for (const finding of fixedOutcomes(healthy))
    warnings.set(findingKey(finding), finding);

  return {
    errors: [...errors.values()],
    warnings: [...warnings.values()],
    coverage:
      healthy.length === 0
        ? null
        : coverageOf(healthy, spec, module, nodePaths),
  };
}

/** Generates a unique key for a finding based on its code, path, and message. */
function findingKey(
  finding: Pick<Finding, "code" | "path" | "message">,
): string {
  return JSON.stringify([finding.code, finding.path ?? null, finding.message]);
}

/** Adds one game's findings; a finding repeated within a game counts that game once. */
function merge(
  into: Map<string, Finding>,
  game: PlayedGame,
  found: Base[],
  total: number,
): void {
  const seen = new Set<string>();
  for (const base of found) {
    const key = findingKey(base);
    if (seen.has(key)) continue;
    seen.add(key);
    const existing = into.get(key);
    if (existing) existing.games++;
    else into.set(key, { ...base, games: 1, total, first: game });
  }
}

/** Generates the list of errors found in a single game's result. */
function gameErrors(
  result: GameResult,
  spec: ModularGameSpec,
  nodePaths: Record<string, string>,
): Base[] {
  const { end, transcript } = result;
  const found: Base[] = [];

  if (end.kind === "error") {
    const { attribution } = end;
    const base = {
      code: attribution.code,
      severity: "error" as const,
      message: end.message,
      hint: attribution.hint,
    };
    let path: string | undefined;
    switch (attribution.code) {
      case "playtest-runaway":
        path = pathOf(nodePaths, end.nodeId);
        break;
      case "playtest-no-legal-actions":
        path = pathOf(nodePaths, end.turnNodeId);
        break;
      case "playtest-unsupported":
        path = end.input
          ? unresolvedInputPath(spec, transcript, end.input)
          : undefined;
        break;
    }
    found.push({ ...base, ...(path !== undefined && { path }) });
  } else if (end.kind === "max-decisions") {
    const path = pathOf(nodePaths, busiestTurn(transcript));
    found.push({
      code: "playtest-no-end",
      severity: "error",
      message: `The game did not finish within ${result.decisions} decisions.`,
      hint:
        "Check that winConditions and loop endConditions can become true, and that actions change the state they read. " +
        "A turn where random play keeps passing can also cause this.",
      ...(path !== undefined && { path }),
    });
  } else if (!transcript.some((entry) => entry.kind === "turn:start")) {
    found.push({
      code: "playtest-ends-immediately",
      severity: "error",
      message: `The game completed before any turn started (${end.outcome.reason}).`,
      hint: "A win condition is already true after setup. Check winConditions against the initial state.",
      path: WIN_CONDITIONS_PATH,
    });
  }

  return found;
}

/** Generates the list of warnings found in a single game's result. */
function gameWarnings(result: GameResult, spec: ModularGameSpec): Base[] {
  const found: Base[] = [];
  for (const entry of result.transcript) {
    if (entry.kind !== "action:forfeit") continue;
    const path =
      entry.actionId === undefined
        ? undefined
        : actionPath(spec, entry.actionId);
    found.push({
      code: "action-forfeit",
      severity: "warning",
      message:
        `A player's ${entry.actionId === undefined ? "action" : `"${entry.actionId}" action`} was abandoned: ` +
        `its effects left input "${entry.inputId}" with nothing to choose from.`,
      hint: "Fine if intended. Otherwise reorder the steps or add a precondition so the action isn't offered then.",
      ...(path !== undefined && { path }),
    });
  }
  return found;
}

/** Checks for fixed outcomes in completed games. */
function fixedOutcomes(candidateGames: PlayedGame[]): Finding[] {
  const byCount = new Map<number, PlayedGame[]>();
  for (const game of candidateGames) {
    if (game.result.end.kind !== "complete") continue;
    byCount.set(game.playerCount, [
      ...(byCount.get(game.playerCount) ?? []),
      game,
    ]);
  }

  const findings: Finding[] = [];
  for (const [playerCount, completed] of byCount) {
    if (completed.length < FIXED_OUTCOME_MIN_GAMES) continue;
    const outcomes = completed.map((game) => describeOutcome(game.result));
    if (new Set(outcomes).size !== 1) continue;
    findings.push({
      code: "fixed-outcome",
      severity: "warning",
      message: `All ${completed.length} completed ${playerCount}-player games ended the same way: ${outcomes[0]}.`,
      hint: "Fine if the game is deterministic. Otherwise check that winConditions and the actions let the result vary.",
      path: WIN_CONDITIONS_PATH,
      games: completed.length,
      total: completed.length,
      first: completed[0],
    });
  }
  return findings;
}

/** Describes the outcome of a completed game. */
export function describeOutcome(result: GameResult): string {
  if (result.end.kind !== "complete") return "";
  const { winnerIds, reason } = result.end.outcome;
  const winners =
    winnerIds === undefined || winnerIds.length === 0
      ? "no winner"
      : `winners ${[...winnerIds].sort().join(", ")}`;
  return `${winners} (${reason})`;
}

/** Analyzes coverage of flow nodes, actions, and passives in a set of healthy games. */
function coverageOf(
  candidateGames: PlayedGame[],
  spec: ModularGameSpec,
  module: CompiledGameModule,
  nodePaths: Record<string, string>,
): Coverage {
  const entered = new Set<string>();
  const started = new Set<string>();
  const fired = new Set<string>();
  const offered = new Map<string, number>();

  for (const { result } of candidateGames) {
    for (const entry of result.transcript) {
      switch (entry.kind) {
        case "flow:enter":
          entered.add(entry.nodeId);
          break;
        case "action:start":
          started.add(entry.actionId);
          break;
        case "passive:fire":
          fired.add(entry.passiveId);
          break;
        case "decision":
          for (const actionId of entry.offered?.actions ?? []) {
            offered.set(actionId, (offered.get(actionId) ?? 0) + 1);
          }
          break;
      }
    }
  }

  const actions = (spec.actions?.actions ?? []).flatMap((action, i) =>
    started.has(action.id)
      ? []
      : [
          {
            actionId: action.id,
            path: `actions.actions[${i}]`,
            offered: offered.get(action.id) ?? 0,
          },
        ],
  );

  const passiveIds = [
    ...new Set(
      (module.passiveActivations ?? []).map(
        (activation) => activation.passiveId,
      ),
    ),
  ];

  return {
    games: candidateGames.length,
    flowNodes: Object.entries(nodePaths)
      .filter(([nodeId]) => !entered.has(nodeId))
      .map(([nodeId, path]) => ({ nodeId, path })),
    actions,
    passives: passiveIds
      .filter((passiveId) => !fired.has(passiveId))
      .map((passiveId) => ({
        passiveId,
        boundBy: passiveBoundBy(spec, passiveId),
      })),
  };
}

/** Catalog entries binding the passive; an inline binding's id is `<typeId>/<slotId>`. */
function passiveBoundBy(spec: ModularGameSpec, passiveId: string): string[] {
  const paths: string[] = [];
  (spec.catalog?.entries ?? []).forEach((entry, i) => {
    const binds = Object.entries(entry.passiveBindings ?? {}).some(
      ([slotId, value]) =>
        (typeof value === "string" ? value : `${entry.typeId}/${slotId}`) ===
        passiveId,
    );
    if (binds) paths.push(`catalog.entries[${i}]`);
  });
  return paths;
}

/** Get the path of a node in the transcript based on its ID. */
const pathOf = (
  nodePaths: Record<string, string>,
  nodeId: string | undefined,
): string | undefined => (nodeId === undefined ? undefined : nodePaths[nodeId]);

/**
 * The turn node with the most decisions among the last {@link NO_END_WINDOW};
 * ties go to the earliest.
 */
function busiestTurn(transcript: TranscriptEntry[]): string | undefined {
  const counts = new Map<string, number>();
  const recent = transcript
    .filter(
      (entry): entry is Extract<TranscriptEntry, { kind: "decision" }> =>
        entry.kind === "decision",
    )
    .slice(-NO_END_WINDOW);
  for (const { turnNodeId } of recent) {
    if (turnNodeId !== undefined)
      counts.set(turnNodeId, (counts.get(turnNodeId) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [nodeId, count] of counts) {
    if (count > bestCount) {
      best = nodeId;
      bestCount = count;
    }
  }
  return best;
}

/** Get the path of an action in the spec based on its ID. */
function actionPath(
  spec: ModularGameSpec,
  actionId: string,
): string | undefined {
  const i = (spec.actions?.actions ?? []).findIndex(
    (action) => action.id === actionId,
  );
  return i < 0 ? undefined : `actions.actions[${i}]`;
}

/** The input step playtest couldn't answer, found in the player's most recent action. */
function unresolvedInputPath(
  spec: ModularGameSpec,
  transcript: TranscriptEntry[],
  input: { playerId: string; inputId: string },
): string | undefined {
  const start = [...transcript]
    .reverse()
    .find(
      (entry) =>
        entry.kind === "action:start" && entry.playerId === input.playerId,
    );
  if (start?.kind !== "action:start") return undefined;
  const actions = spec.actions?.actions ?? [];
  const ai = actions.findIndex((action) => action.id === start.actionId);
  if (ai < 0) return undefined;
  const si = actions[ai].steps.findIndex(
    (step) => (step as { input?: unknown }).input === input.inputId,
  );
  return si < 0
    ? `actions.actions[${ai}]`
    : `actions.actions[${ai}].steps[${si}]`;
}
