// ---------------------------------------------------------------------------
// Text rendering of a playtest run's summary, coverage and replay transcript.
// ---------------------------------------------------------------------------

import type { PlaytestSummary } from "#authoring/tools/playtest/report.js";

/**
 * Renders the per-player-count summary, the seed and, if any, the coverage lists.
 * Coverage is informational and carries no severity.
 */
export function formatSummary(summary: PlaytestSummary): string {
  const lines = [`seed ${summary.seed} (the same seed plays the same games)`];
  for (const s of summary.playerCounts) {
    lines.push(
      `${s.playerCount} players: ${s.games} games (${s.completed} completed, ${s.crashed} crashed, ${s.hitLimit} hit the decision limit), mean ${s.meanDecisions} decisions`,
    );
    if (s.outcomes.length > 0)
      lines.push(
        `  outcomes: ${s.outcomes.map((o) => `${o.outcome} x${o.games}`).join("; ")}`,
      );
  }
  const { coverage } = summary;
  if (coverage) {
    const uncovered = [
      ...coverage.flowNodes.map((n) => `  flow node ${n.path}`),
      ...coverage.actions.map(
        (a) =>
          `  action ${a.actionId} (${a.path}): ${a.offered === 0 ? "never offered" : `offered ${a.offered} times, never taken`}`,
      ),
      ...coverage.passives.map(
        (p) =>
          `  passive ${p.passiveId}${p.boundBy.length > 0 ? ` (bound by ${p.boundBy.join(", ")})` : ""}`,
      ),
    ];
    if (uncovered.length > 0)
      lines.push(
        `not exercised in ${coverage.games} games (informational, not a failure):`,
        ...uncovered,
      );
  }
  return lines.join("\n");
}

/** The replayed game's repro token and transcript, one line per step. */
export function formatReplay(replay: {
  repro: string;
  transcript: string[];
}): string {
  return [
    `replay ${replay.repro}`,
    ...replay.transcript.map((line) => `  ${line}`),
  ].join("\n");
}
