import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { validate } from "@chaincraft/gamedef/validator";
import type { ModularGameSpec } from "@chaincraft/gamedef";
import { assembleModule, flowNodePaths } from "@chaincraft/compiler";
import type { CompiledGameModule } from "@chaincraft/runtime";
import { analyzeRun, missingCatalog } from "../tools/playtest/checks.js";
import type { PlayedGame } from "../tools/playtest/checks.js";
import { attributeError } from "../tools/playtest/attribution.js";
import { GameRuntimeError, StepBudgetExceededError } from "@chaincraft/runtime";
import { playGame } from "../tools/playtest/driver.js";
import type { GameEnd, GameResult, TranscriptEntry } from "../tools/playtest/driver.js";

const EXAMPLES_DIR = fileURLToPath(new URL("../../../gamedef/examples/", import.meta.url));

const raw = yaml.load(readFileSync(`${EXAMPLES_DIR}high-card.yaml`, "utf8"));
const validation = validate(raw);
if (!validation.valid) throw new Error(JSON.stringify(validation.errors, null, 2));
const spec: ModularGameSpec = validation.spec;
const module: CompiledGameModule = assembleModule(spec, "high-card");
const nodePaths = flowNodePaths(spec, "high-card");

const actionId = spec.actions!.actions[0].id;
const inputStep = spec.actions!.actions[0].steps.findIndex((step) => "input" in step);
const inputId = (spec.actions!.actions[0].steps[inputStep] as { input: string }).input;
const [rootId, firstChildId] = Object.keys(nodePaths);

const OUTCOME: GameEnd = { kind: "complete", outcome: { winnerIds: ["p1"], reason: "most tricks" } };

function result(end: GameEnd, transcript: TranscriptEntry[] = [], decisions = 0): GameResult {
  return { gameSeed: 1, policySeed: 1, players: ["p1", "p2"], decisions, transcript, end };
}

const played = (end: GameEnd, transcript: TranscriptEntry[] = [], index = 0, playerCount = 2): PlayedGame => ({
  playerCount,
  index,
  result: result(end, transcript, transcript.filter((e) => e.kind === "decision").length),
});

const errorEnd = (error: unknown, extra: Partial<Extract<GameEnd, { kind: "error" }>> = {}): GameEnd => ({
  kind: "error",
  attribution: attributeError(error),
  message: error instanceof Error ? error.message : String(error),
  ...extra,
});

const turnStart: TranscriptEntry = { kind: "turn:start", nodeId: firstChildId, actors: ["p1"] };
const analyze = (games: PlayedGame[], overrides: { spec?: ModularGameSpec } = {}) =>
  analyzeRun({ spec: overrides.spec ?? spec, module, nodePaths, games });

describe("missing-catalog", () => {
  it("is raised when types are declared and the catalog is absent or empty", () => {
    for (const catalog of [undefined, { entries: [] }]) {
      const finding = missingCatalog({ ...spec, catalog } as ModularGameSpec);
      expect(finding).toMatchObject({ code: "missing-catalog", severity: "error", path: "catalog", first: null });
    }
  });

  it("is not raised with a catalog, or with no gamepiece types", () => {
    expect(missingCatalog(spec)).toBeNull();
    expect(missingCatalog({ ...spec, gamepieceTypes: undefined, catalog: undefined } as ModularGameSpec)).toBeNull();
  });

  it("is included in the run's errors", () => {
    const analysis = analyze([played(OUTCOME, [turnStart])], { spec: { ...spec, catalog: undefined } as ModularGameSpec });
    expect(analysis.errors.map((e) => e.code)).toEqual(["missing-catalog"]);
  });
});

describe("error checks", () => {
  it("playtest-no-legal-actions points at the active turn node", () => {
    const end = errorEnd(new GameRuntimeError("no-legal-actions", "no action for p1"), { turnNodeId: firstChildId });
    const [error] = analyze([played(end)]).errors;
    expect(error).toMatchObject({
      code: "playtest-no-legal-actions",
      severity: "error",
      path: nodePaths[firstChildId],
      message: "no action for p1",
    });
  });

  it("playtest-runaway points at the node id carried by the error", () => {
    const end = errorEnd(new StepBudgetExceededError(10, firstChildId), { turnNodeId: rootId, nodeId: firstChildId });
    const [error] = analyze([played(end)]).errors;
    expect(error).toMatchObject({ code: "playtest-runaway", path: nodePaths[firstChildId] });
  });

  it("playtest-no-end points at the turn with most decisions in the last 100", () => {
    const decision = (turnNodeId: string): TranscriptEntry => ({
      kind: "decision",
      playerId: "p1",
      inputId: "x",
      value: 1,
      turnNodeId,
    });
    // 150 old decisions in the root turn fall outside the window; the last 100 are mostly the child's.
    const transcript = [
      ...Array.from({ length: 150 }, () => decision(rootId)),
      ...Array.from({ length: 60 }, () => decision(firstChildId)),
      ...Array.from({ length: 40 }, () => decision(rootId)),
    ];
    const [error] = analyze([played({ kind: "max-decisions" }, transcript)]).errors;
    expect(error).toMatchObject({ code: "playtest-no-end", severity: "error", path: nodePaths[firstChildId] });
    expect(error.message).toContain("250 decisions");
  });

  it("playtest-ends-immediately fires when the game completes with no turn", () => {
    const [error] = analyze([played(OUTCOME, [{ kind: "complete", reason: "most tricks" }])]).errors;
    expect(error).toMatchObject({
      code: "playtest-ends-immediately",
      path: "flow.root.winConditions",
    });
    expect(analyze([played(OUTCOME, [turnStart])]).errors).toEqual([]);
  });

  it("playtest-unsupported resolves the input step from the player's latest action", () => {
    const transcript: TranscriptEntry[] = [{ kind: "action:start", playerId: "p1", actionId, auto: false }];
    const end = errorEnd(new GameRuntimeError("no-custom-handler", "x"), { input: { playerId: "p1", inputId } });
    const [error] = analyze([played(end, transcript)]).errors;
    expect(error).toMatchObject({
      code: "playtest-unsupported",
      path: `actions.actions[0].steps[${inputStep}]`,
    });
  });

  it("playtest-unsupported has no path when the origin is unknown", () => {
    const [error] = analyze([played(errorEnd(new GameRuntimeError("no-system-responder", "llm")))]).errors;
    expect(error).toMatchObject({ code: "playtest-unsupported" });
    expect(error.path).toBeUndefined();
  });

  it("playtest-spec-error has no path", () => {
    const [error] = analyze([played(errorEnd(new GameRuntimeError("player-target-no-actor", "boom")))]).errors;
    expect(error).toMatchObject({ code: "playtest-spec-error", severity: "error" });
    expect(error.path).toBeUndefined();
  });

  it("engine-error and runtime-error have no path", () => {
    const analysis = analyze([
      played(errorEnd(new GameRuntimeError("walk-mismatch", "engine"))),
      played(errorEnd(new TypeError("undefined is not a function")), [], 1),
    ]);
    expect(analysis.errors.map((e) => [e.code, e.path])).toEqual([
      ["engine-error", undefined],
      ["runtime-error", undefined],
    ]);
  });

  it("deduplicates by code, path and message, counting games and keeping the first", () => {
    const end = errorEnd(new GameRuntimeError("no-legal-actions", "stuck"), { turnNodeId: firstChildId });
    const other = errorEnd(new GameRuntimeError("no-legal-actions", "stuck elsewhere"), { turnNodeId: firstChildId });
    const games = [
      played(OUTCOME, [turnStart], 0),
      played(end, [], 1),
      played(end, [], 2),
      played(other, [], 3),
    ];
    const { errors } = analyze(games);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({ message: "stuck", games: 2, total: 4 });
    expect(errors[0].first).toBe(games[1]);
    expect(errors[1]).toMatchObject({ message: "stuck elsewhere", games: 1, total: 4 });
  });
});

describe("warnings", () => {
  const forfeit: TranscriptEntry = { kind: "action:forfeit", playerId: "p1", actionId, inputId };

  it("action-forfeit points at the action and counts each game once", () => {
    const games = [played(OUTCOME, [turnStart, forfeit, forfeit], 0), played(OUTCOME, [turnStart], 1)];
    const { warnings, errors } = analyze(games);
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      code: "action-forfeit",
      severity: "warning",
      path: "actions.actions[0]",
      games: 1,
      total: 2,
    });
    expect(warnings[0].first).toBe(games[0]);
  });

  it("are computed over games that didn't crash", () => {
    const crash = errorEnd(new GameRuntimeError("walk-mismatch", "engine"));
    const { warnings } = analyze([played(crash, [forfeit]), played(OUTCOME, [turnStart], 1)]);
    expect(warnings).toEqual([]);
  });

  it("emit nothing, and no coverage, when every game crashed", () => {
    const crash = errorEnd(new GameRuntimeError("walk-mismatch", "engine"));
    const analysis = analyze([played(crash, [forfeit]), played(crash, [forfeit], 1)]);
    expect(analysis.warnings).toEqual([]);
    expect(analysis.coverage).toBeNull();
  });

  it("include max-decisions games", () => {
    const { warnings } = analyze([played({ kind: "max-decisions" }, [forfeit])]);
    expect(warnings.map((w) => w.code)).toEqual(["action-forfeit"]);
  });

  describe("fixed-outcome", () => {
    const games = (count: number, outcome: GameEnd = OUTCOME, playerCount = 2) =>
      Array.from({ length: count }, (_, i) => played(outcome, [turnStart], i, playerCount));

    it("fires for 10 identical completed games", () => {
      const { warnings } = analyze(games(10));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        code: "fixed-outcome",
        severity: "warning",
        path: "flow.root.winConditions",
        games: 10,
        total: 10,
      });
      expect(warnings[0].message).toContain("winners p1 (most tricks)");
    });

    it("needs at least 10 completed games", () => {
      expect(analyze(games(9)).warnings).toEqual([]);
    });

    it("doesn't fire when winners differ", () => {
      const other: GameEnd = { kind: "complete", outcome: { winnerIds: ["p2"], reason: "most tricks" } };
      expect(analyze([...games(9), ...games(1, other).map((g) => ({ ...g, index: 9 }))]).warnings).toEqual([]);
    });

    it("doesn't fire when only the reason differs", () => {
      const other: GameEnd = { kind: "complete", outcome: { winnerIds: ["p1"], reason: "forfeit" } };
      expect(analyze([...games(10), { ...games(1, other)[0], index: 10 }]).warnings).toEqual([]);
    });

    it("is judged per player count", () => {
      const { warnings } = analyze([...games(10, OUTCOME, 2), ...games(10, { kind: "complete", outcome: { winnerIds: ["p2"], reason: "x" } }, 3)]);
      expect(warnings.map((w) => w.message)).toEqual([
        expect.stringContaining("2-player"),
        expect.stringContaining("3-player"),
      ]);
    });

    it("ignores games that hit the decision limit", () => {
      const limit = Array.from({ length: 3 }, (_, i) => played({ kind: "max-decisions" }, [turnStart], 10 + i));
      expect(analyze([...games(9), ...limit]).warnings).toEqual([]);
    });
  });
});

describe("coverage", () => {
  it("lists unentered nodes, unstarted actions with offered counts, and unfired passives", () => {
    const decision: TranscriptEntry = {
      kind: "decision",
      playerId: "p1",
      inputId: "pick",
      value: { kind: "pass" },
      offered: { actions: [actionId], canPass: true },
    };
    const withPassives = {
      ...module,
      passiveActivations: [
        { passiveId: "shield", binding: { kind: "piece", pieceId: "a" } },
        { passiveId: "shield", binding: { kind: "piece", pieceId: "b" } },
        { passiveId: "card/onPlay", binding: { kind: "piece", pieceId: "c" } },
        { passiveId: "fired", binding: { kind: "piece", pieceId: "d" } },
      ],
    } as unknown as CompiledGameModule;
    const catalogSpec = {
      ...spec,
      catalog: {
        entries: [
          { typeId: "card", passiveBindings: { guard: "shield" } },
          { typeId: "card" },
          { typeId: "card", passiveBindings: { onPlay: { trigger: {}, effects: [] } } },
          { typeId: "card", passiveBindings: { other: "fired" } },
        ],
      },
    } as unknown as ModularGameSpec;

    const games = [
      played(OUTCOME, [
        { kind: "flow:enter", nodeId: rootId, nodeType: "game" },
        turnStart,
        decision,
        decision,
        { kind: "passive:fire", passiveId: "fired" },
      ]),
    ];
    const { coverage } = analyzeRun({ spec: catalogSpec, module: withPassives, nodePaths, games });

    expect(coverage!.games).toBe(1);
    expect(coverage!.flowNodes.map((n) => n.nodeId)).not.toContain(rootId);
    expect(coverage!.flowNodes).toContainEqual({ nodeId: firstChildId, path: nodePaths[firstChildId] });
    expect(coverage!.actions).toContainEqual({ actionId, path: "actions.actions[0]", offered: 2 });
    expect(coverage!.passives).toEqual([
      { passiveId: "shield", boundBy: ["catalog.entries[0]"] },
      { passiveId: "card/onPlay", boundBy: ["catalog.entries[2]"] },
    ]);
  });

  it("omits actions that were started, even when never offered (auto-executed)", () => {
    const games = [played(OUTCOME, [{ kind: "action:start", playerId: "p1", actionId, auto: true }])];
    expect(analyze(games).coverage!.actions.map((a) => a.actionId)).not.toContain(actionId);
  });

  it("never produces errors or warnings by itself", () => {
    const analysis = analyze([played(OUTCOME, [turnStart])]);
    expect(analysis.coverage!.flowNodes.length).toBeGreaterThan(0);
    expect(analysis.errors).toEqual([]);
    expect(analysis.warnings).toEqual([]);
  });
});

describe("analyzeRun on played High Card games", () => {
  it("reports no errors and covers the flow and actions", async () => {
    const games: PlayedGame[] = [];
    for (let index = 0; index < 10; index++) {
      const seed = index + 1;
      games.push({
        playerCount: 2,
        index,
        result: await playGame({ module, players: ["p1", "p2"], gameSeed: seed, policySeed: seed, maxDecisions: 2000 }),
      });
    }
    const analysis = analyze(games);
    expect(analysis.errors).toEqual([]);
    expect(analysis.coverage).toEqual({ games: 10, flowNodes: [], actions: [], passives: [] });
  });
});
