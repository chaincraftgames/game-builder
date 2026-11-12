import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { GameController, GameRuntimeError, IllegalActionError } from "@chaincraft/runtime";
import type { CompiledGameModule } from "@chaincraft/runtime";
import { flowNodePaths } from "@chaincraft/compiler";
import type { Diagnostic } from "../diagnostics.js";
import { compile } from "../tools/compile.js";
import { playtest } from "../tools/playtest.js";
import { analyzeRun } from "../tools/playtest/checks.js";
import { playRun } from "../tools/playtest/run.js";

const FIXTURES_DIR = fileURLToPath(new URL("./fixtures/playtest/", import.meta.url));
const EXAMPLES_DIR = fileURLToPath(new URL("../../../gamedef/examples/", import.meta.url));

type Repro = Diagnostic & { repro?: string };

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cc-playtest-fixture-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Writes a single-file spec as a project: one `spec/<module>.yaml` per top-level key. */
function projectFrom(file: string, id: string): void {
  const spec = yaml.load(readFileSync(file, "utf8")) as Record<string, unknown>;
  mkdirSync(join(dir, "spec"), { recursive: true });
  writeFileSync(join(dir, "chaincraft.yaml"), `id: ${id}\nengine:\n  authoring: 0.1.0\n  runtime: 0.1.0\n`);
  for (const [key, value] of Object.entries(spec)) {
    writeFileSync(join(dir, "spec", `${key}.yaml`), yaml.dump({ [key]: value }));
  }
}

const fixture = (name: string) => projectFrom(join(FIXTURES_DIR, `${name}.yaml`), name);

const TURN = "flow.root.children[0].children[0]";
const WIN = "flow.root.winConditions";

interface Case {
  fixture: string;
  code: string;
  severity: "error" | "warning";
  path: string | undefined;
  /** False when the finding can't be reproduced from one game (`fixed-outcome`) or has no repro. */
  replay: boolean;
}

const CASES: Case[] = [
  { fixture: "missing-catalog", code: "missing-catalog", severity: "error", path: "catalog", replay: false },
  { fixture: "no-legal-actions", code: "playtest-no-legal-actions", severity: "error", path: TURN, replay: true },
  { fixture: "no-end", code: "playtest-no-end", severity: "error", path: TURN, replay: true },
  { fixture: "runaway", code: "playtest-runaway", severity: "error", path: TURN, replay: true },
  { fixture: "ends-immediately", code: "playtest-ends-immediately", severity: "error", path: WIN, replay: true },
  {
    fixture: "unsupported-input",
    code: "playtest-unsupported",
    severity: "error",
    path: "actions.actions[0].steps[0]",
    replay: true,
  },
  { fixture: "unsupported-custom", code: "playtest-unsupported", severity: "error", path: undefined, replay: true },
  { fixture: "spec-error", code: "playtest-spec-error", severity: "error", path: undefined, replay: true },
  { fixture: "action-forfeit", code: "action-forfeit", severity: "warning", path: "actions.actions[0]", replay: true },
  { fixture: "fixed-outcome", code: "fixed-outcome", severity: "warning", path: WIN, replay: false },
];

// Small enough for the no-end fixture to stop quickly; enough games for fixed-outcome's minimum.
const MAX_DECISIONS = 50;
const GAMES = 10;

const run = (options: { games?: number; replay?: string } = {}) =>
  playtest(dir, { maxDecisions: MAX_DECISIONS, ...(options.replay === undefined ? { games: GAMES } : options) });

describe.each(CASES)("fixture $fixture", (c) => {
  it(`reports ${c.code} as ${c.severity} at ${c.path ?? "no path"}`, async () => {
    fixture(c.fixture);
    const result = await run();
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    const found = result.diagnostics.filter((d) => d.code === c.code);

    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe(c.severity);
    expect(found[0].path).toBe(c.path);
    if (c.severity === "error") {
      expect(errors.map((d) => d.code)).toEqual([c.code]);
      expect(result.ok).toBe(false);
    } else {
      expect(errors).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });

  it("is deterministic: the same arguments give identical output", async () => {
    fixture(c.fixture);
    expect(JSON.stringify(await run())).toBe(JSON.stringify(await run()));
  });

  if (c.replay) {
    it("--replay of the finding's repro reproduces it", async () => {
      fixture(c.fixture);
      const finding = (await run()).diagnostics.find((d: Repro) => d.code === c.code) as Repro;
      expect(finding.repro).toMatch(/^p2-s1-g\d+$/);

      const replay = await run({ replay: finding.repro });
      const again = replay.diagnostics.find((d) => d.code === c.code);
      expect(again).toMatchObject({ severity: c.severity, code: c.code });
      expect(again?.path).toBe(c.path);
      expect(replay.replay?.repro).toBe(finding.repro);
      expect(replay.ok).toBe(c.severity === "warning");
    });
  }
});

describe("injected faults", () => {
  const compiled = (name: string): CompiledGameModule => {
    fixture(name);
    const result = compile(dir);
    if (!result.ok || !result.module) throw new Error(JSON.stringify(result.diagnostics));
    return result.module;
  };

  const analyze = async (module: CompiledGameModule, name: string) => {
    const result = compile(dir);
    const games = await playRun(module, { seed: 1, games: 2, playerCounts: [2], maxDecisions: MAX_DECISIONS });
    return analyzeRun({ spec: result.spec!, module, nodePaths: flowNodePaths(result.spec!, name), games });
  };

  it("runtime-error: an untagged throw is reported as unclassified", async () => {
    const base = compiled("fixed-outcome");
    const faulty: CompiledGameModule = {
      ...base,
      createSession: () => {
        throw new TypeError("boom");
      },
    };
    const { errors } = await analyze(faulty, "fixed-outcome");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "runtime-error", severity: "error", message: "boom" });
    expect(errors[0].path).toBeUndefined();
  });

  it("engine-error: an engine-origin fault is labeled as an engine bug", async () => {
    const base = compiled("fixed-outcome");
    const faulty: CompiledGameModule = {
      ...base,
      createSession: () => {
        throw new GameRuntimeError("walk-mismatch", "walk disagreed with execution");
      },
    };
    const { errors } = await analyze(faulty, "fixed-outcome");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "engine-error", severity: "error" });
    expect(errors[0].hint).toContain("engine bug, not your spec");
    expect(errors[0].path).toBeUndefined();
  });

  it("engine-error: an offered value the engine then rejects", async () => {
    const module = compiled("no-end");
    // The engine's own checks keep prompts and answers consistent, so only a controller bug can reject an offered value.
    const original = GameController.prototype.processAction;
    GameController.prototype.processAction = async () => {
      throw new IllegalActionError('Player "p1" response 0 to "amount" rejected: not in allowed options', 0, "amount");
    };
    try {
      const { errors } = await analyze(module, "no-end");
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ code: "engine-error", severity: "error", games: 2, total: 2 });
      expect(errors[0].message).toContain("rejected");
      expect(errors[0].hint).toContain("engine bug, not your spec");
      expect(errors[0].path).toBeUndefined();
    } finally {
      GameController.prototype.processAction = original;
    }
  });
});

describe("examples", () => {
  // Cannot be compiled today (see the step-3 plan, R4 measurements); a fixed list keeps a newly compilable one from slipping by.
  const NOT_COMPILABLE = ["absurd-armaments", "board-battler-v18", "passive-battler", "standard_deck"];

  const names = readdirSync(EXAMPLES_DIR)
    .filter((file) => file.endsWith(".yaml"))
    .map((file) => file.replace(/\.yaml$/, ""))
    .sort();

  it.each(names.filter((name) => !NOT_COMPILABLE.includes(name)))("%s: playtest reports zero errors", async (name) => {
    projectFrom(join(EXAMPLES_DIR, `${name}.yaml`), name);
    const result = await playtest(dir);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it.each(NOT_COMPILABLE)("%s: still does not compile", async (name) => {
    projectFrom(join(EXAMPLES_DIR, `${name}.yaml`), name);
    expect((await playtest(dir)).ok).toBe(false);
  });
});
