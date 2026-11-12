// ---------------------------------------------------------------------------
// Playtest report — turns an analyzed run into diagnostics, a summary and (for replay) a transcript.
//
// Pure: no fs, no console. Every diagnostic carries the repro token of the first game that
// showed it; errors also carry the tail of that game's transcript so the agent can see how the
// game got there without replaying it.
// ---------------------------------------------------------------------------

import type { Diagnostic } from "#authoring/diagnostics.js";
import { mapFile } from "#authoring/diagnostics.js";
import {
  analyzeRun,
  describeOutcome,
} from "#authoring/tools/playtest/checks.js";
import type {
  Coverage,
  Finding,
  PlayedGame,
  RunInput,
} from "#authoring/tools/playtest/checks.js";
import type {
  GameResult,
  TranscriptEntry,
} from "#authoring/tools/playtest/driver.js";
import { formatRepro } from "#authoring/tools/playtest/run.js";

/** Transcript lines attached to each error. */
export const TAIL_LINES = 10;

/** Outcomes listed per player count in the summary. */
export const TOP_OUTCOMES = 3;

const MAX_VALUE_CHARS = 60;
const MAX_MESSAGE_CHARS = 120;

/** What happened across the games of one player count. */
export interface PlayerCountSummary {
  playerCount: number;
  games: number;
  completed: number;
  /** Games that ended in an error. */
  crashed: number;
  /** Games stopped at `maxDecisions`. */
  hitLimit: number;
  /** Over all games of this count, crashed ones included; one decimal. */
  meanDecisions: number;
  /** Most common outcomes of the completed games. */
  outcomes: { outcome: string; games: number }[];
}

/** Everything about a run that isn't a diagnostic. */
export interface PlaytestSummary {
  seed: number;
  playerCounts: PlayerCountSummary[];
  /** Informational only; `null` when every game crashed and for a replay. */
  coverage: Coverage | null;
}

/** The result of a playtest run or replay. */
export interface PlaytestReport {
  /** True when there are no errors; warnings and coverage don't count. */
  ok: boolean;
  /** Errors first, then warnings. */
  diagnostics: Diagnostic[];
  summary: PlaytestSummary;
  /** Present for a replay only. */
  replay?: { repro: string; transcript: string[] };
}

/** Input for {@link buildReport}. */
export interface ReportInput extends RunInput {
  /** The base seed of the run, which the repro tokens carry. */
  seed: number;
  /** Module key to project-relative file, for the diagnostics' `file`. */
  moduleFiles?: Record<string, string>;
}

/** Report for a whole run. */
export function buildReport(input: ReportInput): PlaytestReport {
  const analysis = analyzeRun(input);
  return {
    ok: analysis.errors.length === 0,
    diagnostics: [
      ...analysis.errors.map((finding) => toDiagnostic(finding, input, true)),
      ...analysis.warnings.map((finding) => toDiagnostic(finding, input, true)),
    ],
    summary: {
      seed: input.seed,
      playerCounts: summarize(input.games),
      coverage: analysis.coverage,
    },
  };
}

/** Input for {@link buildReplayReport}. */
export interface ReplayInput extends Omit<ReportInput, "games"> {
  game: PlayedGame;
}

/** Report for one replayed game: its full transcript, then the diagnostics that game alone shows. */
export function buildReplayReport(input: ReplayInput): PlaytestReport {
  const { game, ...rest } = input;
  const analysis = analyzeRun({ ...rest, games: [game] });
  const repro = formatRepro({
    seed: input.seed,
    playerCount: game.playerCount,
    index: game.index,
  });
  return {
    ok: analysis.errors.length === 0,
    diagnostics: [
      ...analysis.errors.map((finding) => toDiagnostic(finding, input, false)),
      ...analysis.warnings.map((finding) =>
        toDiagnostic(finding, input, false),
      ),
    ],
    summary: {
      seed: input.seed,
      playerCounts: summarize([game]),
      coverage: null,
    },
    replay: {
      repro,
      transcript: formatFullTranscript(game.result, input.nodePaths),
    },
  };
}

/** Converts a finding into a diagnostic, optionally including repro information. */
function toDiagnostic(
  finding: Finding,
  input: Pick<ReportInput, "seed" | "nodePaths" | "moduleFiles">,
  counted: boolean,
): Diagnostic {
  const lines = [
    counted && finding.first !== null
      ? `${finding.message} (in ${finding.games} of ${finding.total} games)`
      : finding.message,
    `hint: ${finding.hint}`,
  ];
  if (finding.severity === "error" && finding.first !== null) {
    const tail = formatTail(finding.first.result.transcript, input.nodePaths);
    if (tail.length > 0)
      lines.push(
        `last ${tail.length} steps of the first game:`,
        ...tail.map((line) => `  ${line}`),
      );
  }
  const file =
    finding.path === undefined
      ? undefined
      : mapFile(finding.path, input.moduleFiles ?? {});
  return {
    severity: finding.severity,
    code: finding.code,
    message: lines.join("\n"),
    ...(finding.path !== undefined && { path: finding.path }),
    ...(file !== undefined && { file }),
    ...(finding.first !== null && {
      repro: formatRepro({
        seed: input.seed,
        playerCount: finding.first.playerCount,
        index: finding.first.index,
      }),
    }),
  };
}

/** One summary per player count, in ascending order. */
function summarize(games: PlayedGame[]): PlayerCountSummary[] {
  const counts = [...new Set(games.map((game) => game.playerCount))].sort(
    (a, b) => a - b,
  );
  return counts.map((playerCount) => {
    const group = games.filter((game) => game.playerCount === playerCount);
    const tally = new Map<string, number>();
    for (const { result } of group) {
      if (result.end.kind !== "complete") continue;
      const outcome = describeOutcome(result);
      tally.set(outcome, (tally.get(outcome) ?? 0) + 1);
    }
    const kinds = group.map((game) => game.result.end.kind);
    const decisions = group.reduce(
      (sum, game) => sum + game.result.decisions,
      0,
    );
    return {
      playerCount,
      games: group.length,
      completed: kinds.filter((kind) => kind === "complete").length,
      crashed: kinds.filter((kind) => kind === "error").length,
      hitLimit: kinds.filter((kind) => kind === "max-decisions").length,
      meanDecisions: Math.round((decisions / group.length) * 10) / 10,
      outcomes: [...tally]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .slice(0, TOP_OUTCOMES)
        .map(([outcome, games]) => ({ outcome, games })),
    };
  });
}

/** The last {@link TAIL_LINES} decisions, messages and turn boundaries. */
export function formatTail(
  transcript: TranscriptEntry[],
  nodePaths: Record<string, string>,
): string[] {
  const lines: string[] = [];
  for (const entry of transcript) {
    if (!["decision", "message", "turn:start", "turn:end"].includes(entry.kind))
      continue;
    const line = formatEntry(entry, nodePaths);
    if (line !== undefined) lines.push(line);
  }
  return lines.slice(-TAIL_LINES);
}

/** Every transcript entry, then how the game ended. */
export function formatFullTranscript(
  result: GameResult,
  nodePaths: Record<string, string>,
): string[] {
  const lines = result.transcript.flatMap(
    (entry) => formatEntry(entry, nodePaths) ?? [],
  );
  const { end } = result;
  if (end.kind === "error")
    lines.push(`error ${end.attribution.code}: ${end.message}`);
  else if (end.kind === "max-decisions")
    lines.push(`stopped after ${result.decisions} decisions`);
  return lines;
}

/** Formats a single transcript entry into a human-readable string. */
function formatEntry(
  entry: TranscriptEntry,
  nodePaths: Record<string, string>,
): string | undefined {
  const node = (nodeId: string) => nodePaths[nodeId] ?? nodeId;
  switch (entry.kind) {
    case "decision":
      return `${entry.playerId} ${entry.inputId}: ${formatValue(entry.value)}`;
    case "message":
      return `message to ${entry.recipients.join(", ")}: ${truncate(entry.content.replaceAll("\n", " "), MAX_MESSAGE_CHARS)}`;
    case "turn:start":
      return `turn start ${node(entry.nodeId)} (${entry.actors.join(", ")})`;
    case "turn:end":
      return `turn end ${node(entry.nodeId)} (${entry.actors.join(", ")})`;
    case "flow:enter":
      return `enter ${entry.nodeType} ${node(entry.nodeId)}`;
    case "action:start":
      return `${entry.playerId} starts ${entry.actionId}${entry.auto ? " (automatic)" : ""}`;
    case "action:forfeit":
      return `${entry.playerId} abandons ${entry.actionId ?? "an action"} at input ${entry.inputId}`;
    case "passive:fire":
      return `passive ${entry.passiveId} fires${entry.ownerPieceId === undefined ? "" : ` on ${entry.ownerPieceId}`}`;
    case "complete": {
      const winners = entry.winnerIds?.length
        ? `winners ${entry.winnerIds.join(", ")}`
        : "no winner";
      return `game complete: ${winners} (${entry.reason})`;
    }
  }
}

/** Formats a value for display in a transcript entry. */
function formatValue(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    const { kind, actionId } = value as { kind?: unknown; actionId?: unknown };
    if (kind === "pass") return "pass";
    if (kind === "act" && typeof actionId === "string")
      return `act ${actionId}`;
  }
  return truncate(JSON.stringify(value) ?? String(value), MAX_VALUE_CHARS);
}

/** Truncates a string to a maximum length, adding an ellipsis if necessary. */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
