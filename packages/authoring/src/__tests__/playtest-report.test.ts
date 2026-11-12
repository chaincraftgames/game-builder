import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { validate } from "@chaincraft/gamedef/validator";
import type { ModularGameSpec } from "@chaincraft/gamedef";
import { assembleModule, flowNodePaths } from "@chaincraft/compiler";
import type { CompiledGameModule } from "@chaincraft/runtime";
import { GameRuntimeError } from "@chaincraft/runtime";
import { attributeError } from "../tools/playtest/attribution.js";
import type { PlayedGame } from "../tools/playtest/checks.js";
import type { GameEnd, GameResult, TranscriptEntry } from "../tools/playtest/driver.js";
import {
  formatRepro,
  gameSeedFor,
  parseRepro,
  playOne,
  playRun,
  policySeedFor,
} from "../tools/playtest/run.js";
import { buildReplayReport, buildReport, TAIL_LINES, TOP_OUTCOMES } from "../tools/playtest/report.js";
import { formatDiagnostic } from "../diagnostics.js";

const EXAMPLES_DIR = fileURLToPath(new URL("../../../gamedef/examples/", import.meta.url));

const raw = yaml.load(readFileSync(`${EXAMPLES_DIR}high-card.yaml`, "utf8"));
const validation = validate(raw);
if (!validation.valid) throw new Error(JSON.stringify(validation.errors, null, 2));
const spec: ModularGameSpec = validation.spec;
const module: CompiledGameModule = assembleModule(spec, "high-card");
const nodePaths = flowNodePaths(spec, "high-card");
const [, firstChildId] = Object.keys(nodePaths);

const MAX_DECISIONS = 2000;

describe("repro tokens", () => {
  it("round-trips", () => {
    const id = { seed: 7, playerCount: 4, index: 12 };
    expect(formatRepro(id)).toBe("p4-s7-g12");
    expect(parseRepro("p4-s7-g12")).toEqual(id);
  });

  it("rejects malformed tokens", () => {
    for (const token of ["", "p2-s1", "p2-s1-g", "2-1-1", "p0-s1-g0", "p2-s-1-g0", "p2-s1-g0-x", "pa-s1-g0"]) {
      expect(parseRepro(token)).toBeNull();
    }
  });

  it("derives seeds that are stable, distinct per game and distinct between game and policy", () => {
    const id = { seed: 1, playerCount: 2, index: 0 };
    expect(gameSeedFor(id)).toBe(gameSeedFor({ ...id }));
    const seeds = new Set<number>();
    for (const seed of [1, 2]) {
      for (const playerCount of [2, 3]) {
        for (let index = 0; index < 20; index++) {
          seeds.add(gameSeedFor({ seed, playerCount, index }));
          seeds.add(policySeedFor({ seed, playerCount, index }));
        }
      }
    }
    expect(seeds.size).toBe(2 * 2 * 20 * 2);
    expect(Number.isInteger(gameSeedFor(id))).toBe(true);
  });
});

describe("playRun and replay", () => {
  it("plays games per player count in order, deterministically", async () => {
    const options = { seed: 1, games: 3, playerCounts: [2, 3], maxDecisions: MAX_DECISIONS };
    const run = await playRun(module, options);
    expect(run.map((g) => [g.playerCount, g.index])).toEqual([
      [2, 0],
      [2, 1],
      [2, 2],
      [3, 0],
      [3, 1],
      [3, 2],
    ]);
    expect(await playRun(module, options)).toEqual(run);
  });

  it("replaying a token reproduces that game exactly", async () => {
    const run = await playRun(module, { seed: 5, games: 4, playerCounts: [2], maxDecisions: MAX_DECISIONS });
    const id = parseRepro("p2-s5-g2")!;
    expect(await playOne(module, id, { maxDecisions: MAX_DECISIONS })).toEqual(run[2]);
  });
});

const OUTCOME: GameEnd = { kind: "complete", outcome: { winnerIds: ["p1"], reason: "most tricks" } };

function played(end: GameEnd, transcript: TranscriptEntry[] = [], index = 0, playerCount = 2): PlayedGame {
  const result: GameResult = {
    gameSeed: 1,
    policySeed: 1,
    players: ["p1", "p2"],
    decisions: transcript.filter((e) => e.kind === "decision").length,
    transcript,
    end,
  };
  return { playerCount, index, result };
}

const decision = (n: number): TranscriptEntry => ({
  kind: "decision",
  playerId: "p1",
  inputId: "pick",
  value: n,
});

const report = (games: PlayedGame[], overrides: { spec?: ModularGameSpec } = {}) =>
  buildReport({ spec: overrides.spec ?? spec, module, nodePaths, games, seed: 9 });

describe("buildReport on a real run", () => {
  it("is ok with a summary for the player count", async () => {
    const games = await playRun(module, { seed: 1, games: 6, playerCounts: [2], maxDecisions: MAX_DECISIONS });
    const result = buildReport({ spec, module, nodePaths, games, seed: 1 });
    expect(result.ok).toBe(true);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.summary.seed).toBe(1);
    expect(result.summary.playerCounts.map((s) => s.playerCount)).toEqual([2]);
    for (const summary of result.summary.playerCounts) {
      expect(summary).toMatchObject({ games: 6, completed: 6, crashed: 0, hitLimit: 0 });
      expect(summary.meanDecisions).toBeGreaterThan(0);
      expect(summary.outcomes.length).toBeLessThanOrEqual(TOP_OUTCOMES);
      expect(summary.outcomes.reduce((sum, o) => sum + o.games, 0)).toBeLessThanOrEqual(6);
    }
    expect(result.replay).toBeUndefined();
  });

  it("gives identical JSON for identical runs", async () => {
    const options = { seed: 3, games: 4, playerCounts: [2], maxDecisions: MAX_DECISIONS };
    const [a, b] = await Promise.all([playRun(module, options), playRun(module, options)]);
    expect(JSON.stringify(buildReport({ spec, module, nodePaths, games: b, seed: 3 }))).toBe(
      JSON.stringify(buildReport({ spec, module, nodePaths, games: a, seed: 3 })),
    );
  });
});

describe("summary", () => {
  it("has one entry per player count, ascending", () => {
    const turn: TranscriptEntry = { kind: "turn:start", nodeId: firstChildId, actors: ["p1"] };
    const games = [played(OUTCOME, [turn], 0, 4), played(OUTCOME, [turn], 0, 2), played(OUTCOME, [turn], 1, 4)];
    const counts = report(games).summary.playerCounts.map((s) => [s.playerCount, s.games]);
    expect(counts).toEqual([
      [2, 1],
      [4, 2],
    ]);
  });

  it("counts crashed and limit-hit games and averages decisions over all of them", () => {
    const crash: GameEnd = {
      kind: "error",
      attribution: attributeError(new GameRuntimeError("no-legal-actions", "x")),
      message: "x",
    };
    const result = report([
      played(OUTCOME, [decision(1), decision(2), { kind: "turn:start", nodeId: firstChildId, actors: ["p1"] }]),
      played(crash, [decision(1)], 1),
      played({ kind: "max-decisions" }, [decision(1), decision(2), decision(3), decision(4)], 2),
    ]);
    expect(result.summary.playerCounts).toEqual([
      {
        playerCount: 2,
        games: 3,
        completed: 1,
        crashed: 1,
        hitLimit: 1,
        meanDecisions: 2.3,
        outcomes: [{ outcome: "winners p1 (most tricks)", games: 1 }],
      },
    ]);
  });

  it("lists the top outcomes by count, ties in text order", () => {
    const end = (winner: string): GameEnd => ({ kind: "complete", outcome: { winnerIds: [winner], reason: "r" } });
    const turn: TranscriptEntry = { kind: "turn:start", nodeId: firstChildId, actors: ["p1"] };
    const winners = ["p2", "p1", "p2", "p3", "p4", "p2", "p1"];
    const games = winners.map((w, i) => played(end(w), [turn], i));
    const { outcomes } = report(games).summary.playerCounts[0];
    expect(outcomes).toEqual([
      { outcome: "winners p2 (r)", games: 3 },
      { outcome: "winners p1 (r)", games: 2 },
      { outcome: "winners p3 (r)", games: 1 },
    ]);
  });
});

describe("error diagnostics", () => {
  const crash = (): GameEnd => ({
    kind: "error",
    attribution: attributeError(new GameRuntimeError("no-legal-actions", "no action for p1")),
    message: "no action for p1",
    turnNodeId: firstChildId,
  });
  const turn: TranscriptEntry = { kind: "turn:start", nodeId: firstChildId, actors: ["p1"] };

  it("carries the repro of the first game, the count and the hint", () => {
    const games = [played(OUTCOME, [turn], 0), played(crash(), [turn], 3), played(crash(), [turn], 5)];
    const [diagnostic] = report(games).diagnostics;
    expect(diagnostic).toMatchObject({
      severity: "error",
      code: "playtest-no-legal-actions",
      path: nodePaths[firstChildId],
      repro: "p2-s9-g3",
    });
    expect(diagnostic.message).toContain("no action for p1 (in 2 of 3 games)");
    expect(diagnostic.message).toContain("hint: ");
  });

  it("appends only the last transcript lines, limited to decisions, messages and turn boundaries", () => {
    const transcript: TranscriptEntry[] = [
      turn,
      ...Array.from({ length: 15 }, (_, i) => decision(i)),
      { kind: "flow:enter", nodeId: firstChildId, nodeType: "turn" },
      { kind: "message", recipients: ["p1", "p2"], content: "line one\nline two" },
    ];
    const [diagnostic] = report([played(crash(), transcript)]).diagnostics;
    const lines = diagnostic.message.split("\n");
    const at = lines.findIndex((line) => line.startsWith("last "));
    expect(lines[at]).toBe(`last ${TAIL_LINES} steps of the first game:`);
    const tail = lines.slice(at + 1);
    expect(tail).toHaveLength(TAIL_LINES);
    expect(tail.at(-1)).toBe("  message to p1, p2: line one line two");
    expect(tail.at(-2)).toBe("  p1 pick: 14");
    expect(tail.some((line) => line.includes("enter "))).toBe(false);
  });

  it("renders act and pass choices readably", () => {
    const transcript: TranscriptEntry[] = [
      { kind: "decision", playerId: "p2", inputId: "act", value: { kind: "act", actionId: "attack" } },
      { kind: "decision", playerId: "p1", inputId: "act", value: { kind: "pass" } },
    ];
    const [diagnostic] = report([played(crash(), transcript)]).diagnostics;
    expect(diagnostic.message).toContain("  p2 act: act attack");
    expect(diagnostic.message).toContain("  p1 act: pass");
  });

  it("has no repro or tail for a check made before any game", () => {
    const result = report([played(OUTCOME, [turn])], { spec: { ...spec, catalog: undefined } as ModularGameSpec });
    const missing = result.diagnostics.find((d) => d.code === "missing-catalog")!;
    expect(missing.repro).toBeUndefined();
    expect(missing.message).not.toContain("last ");
    expect(missing.message).not.toContain("games)");
    expect(result.ok).toBe(false);
  });

  it("prints the repro and indents the body in text output", () => {
    const [diagnostic] = report([played(crash(), [turn])]).diagnostics;
    const text = formatDiagnostic(diagnostic);
    expect(text).toContain("  repro: p2-s9-g0");
    expect(text).toContain("\n  hint: ");
    expect(text).toContain("\n  last ");
  });
});

describe("warning diagnostics", () => {
  it("carry a repro but no transcript, and don't fail the run", () => {
    const turn: TranscriptEntry = { kind: "turn:start", nodeId: firstChildId, actors: ["p1"] };
    const forfeit: TranscriptEntry = { kind: "action:forfeit", playerId: "p1", inputId: "x" };
    const result = report([played(OUTCOME, [turn, forfeit], 4)]);
    expect(result.ok).toBe(true);
    const warning = result.diagnostics.find((d) => d.code === "action-forfeit")!;
    expect(warning).toMatchObject({ severity: "warning", repro: "p2-s9-g4" });
    expect(warning.message).not.toContain("last ");
  });

  it("come after errors", () => {
    const turn: TranscriptEntry = { kind: "turn:start", nodeId: firstChildId, actors: ["p1"] };
    const forfeit: TranscriptEntry = { kind: "action:forfeit", playerId: "p1", inputId: "x" };
    const result = report(
      [played(OUTCOME, [turn, forfeit]), played({ kind: "max-decisions" }, [decision(1)], 1)],
    );
    expect(result.diagnostics.map((d) => d.severity)).toEqual(["error", "warning"]);
  });
});

describe("replay report", () => {
  it("prints the full transcript and the same error without a game count", async () => {
    const game = played(
      {
        kind: "error",
        attribution: attributeError(new GameRuntimeError("no-legal-actions", "no action for p1")),
        message: "no action for p1",
        turnNodeId: firstChildId,
      },
      [
        { kind: "turn:start", nodeId: firstChildId, actors: ["p1"] },
        { kind: "action:start", playerId: "p1", actionId: "draw", auto: true },
        decision(1),
      ],
      2,
    );
    const result = buildReplayReport({ spec, module, nodePaths, game, seed: 9 });
    expect(result.ok).toBe(false);
    expect(result.replay).toEqual({
      repro: "p2-s9-g2",
      transcript: [
        `turn start ${nodePaths[firstChildId]} (p1)`,
        "p1 starts draw (automatic)",
        "p1 pick: 1",
        "error playtest-no-legal-actions: no action for p1",
      ],
    });
    const [diagnostic] = result.diagnostics;
    expect(diagnostic).toMatchObject({ code: "playtest-no-legal-actions", repro: "p2-s9-g2" });
    expect(diagnostic.message).not.toContain("games)");
    expect(result.summary.coverage).toBeNull();
  });

  it("replays a real game to the same transcript the run saw", async () => {
    const run = await playRun(module, { seed: 2, games: 3, playerCounts: [2], maxDecisions: MAX_DECISIONS });
    const game = await playOne(module, parseRepro("p2-s2-g1")!, { maxDecisions: MAX_DECISIONS });
    const result = buildReplayReport({ spec, module, nodePaths, game, seed: 2 });
    expect(game).toEqual(run[1]);
    expect(result.ok).toBe(true);
    expect(result.replay!.transcript.at(-1)).toMatch(/^game complete: /);
  });
});
