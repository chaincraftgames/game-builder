import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { validate } from "@chaincraft/gamedef/validator";
import { assembleModule } from "@chaincraft/compiler";
import type { CompiledGameModule } from "@chaincraft/runtime";
import { GameRuntimeError, StepBudgetExceededError } from "@chaincraft/runtime";
import { MAX_GENERATED_RETRIES, playGame } from "../tools/playtest/driver.js";
import type { GameOptions, TranscriptEntry } from "../tools/playtest/driver.js";

const EXAMPLES_DIR = fileURLToPath(new URL("../../../gamedef/examples/", import.meta.url));

type Raw = Record<string, any>;

function highCard(patch?: (raw: Raw) => void): CompiledGameModule {
  const raw = yaml.load(readFileSync(`${EXAMPLES_DIR}high-card.yaml`, "utf8")) as Raw;
  patch?.(raw);
  const result = validate(raw);
  if (!result.valid) throw new Error(JSON.stringify(result.errors, null, 2));
  return assembleModule(result.spec, "high-card");
}

const addInput = (input: Raw) => (raw: Raw) => raw.actions.actions[0].steps.unshift(input);

const options = (module: CompiledGameModule, overrides: Partial<GameOptions> = {}): GameOptions => ({
  module,
  players: ["p1", "p2"],
  gameSeed: 1,
  policySeed: 1,
  maxDecisions: 2000,
  ...overrides,
});

type Decision = Extract<TranscriptEntry, { kind: "decision" }>;
const decisions = (transcript: TranscriptEntry[]): Decision[] =>
  transcript.filter((e): e is Decision => e.kind === "decision");

describe("playGame on High Card", () => {
  const module = highCard();

  it("completes a game with an outcome", async () => {
    const result = await playGame(options(module));
    expect(result.end.kind).toBe("complete");
    expect(result.decisions).toBe(decisions(result.transcript).length);
    expect(result.transcript.at(-1)).toMatchObject({ kind: "complete" });
    expect(result.transcript.some((e) => e.kind === "turn:start")).toBe(true);
    expect(result.transcript.some((e) => e.kind === "message")).toBe(true);
  });

  it("is deterministic: same seeds give an identical result", async () => {
    const [a, b] = await Promise.all([playGame(options(module)), playGame(options(module))]);
    expect(b).toEqual(a);
  });

  it("varies with the seeds", async () => {
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((seed) => playGame(options(module, { gameSeed: seed, policySeed: seed }))),
    );
    expect(new Set(results.map((r) => JSON.stringify(r.transcript))).size).toBeGreaterThan(1);
  });

  it("takes every decision value from the offered set", async () => {
    for (const seed of [1, 2, 3]) {
      const { transcript } = await playGame(options(module, { gameSeed: seed, policySeed: seed }));
      for (const decision of decisions(transcript)) {
        if (decision.offered) {
          const offered: unknown[] = [
            ...decision.offered.actions.map((actionId) => ({ kind: "act", actionId })),
            ...(decision.offered.canPass ? [{ kind: "pass" }] : []),
          ];
          expect(offered).toContainEqual(decision.value);
        } else {
          expect(decision.options).toContain(decision.value);
        }
      }
    }
  });

  it("stops at maxDecisions", async () => {
    const result = await playGame(options(module, { maxDecisions: 2 }));
    expect(result.end).toEqual({ kind: "max-decisions" });
    expect(result.decisions).toBe(2);
  });
});

describe("playGame generated values", () => {
  it("draws an unlisted number inside its bounds", async () => {
    const module = highCard(addInput({ input: "bid", type: { kind: "number", min: 1, max: 100 } }));
    const result = await playGame(options(module));
    expect(result.end.kind).toBe("complete");
    const bids = decisions(result.transcript).filter((d) => d.inputId === "bid");
    expect(bids.length).toBeGreaterThan(0);
    for (const bid of bids) {
      expect(bid.options).toBeUndefined();
      expect(Number.isInteger(bid.value)).toBe(true);
      expect(bid.value as number).toBeGreaterThanOrEqual(1);
      expect(bid.value as number).toBeLessThanOrEqual(100);
    }
  });

  it("draws a fractional number when integer is false", async () => {
    const module = highCard(addInput({ input: "bid", type: { kind: "number", min: 0, max: 1, integer: false } }));
    const result = await playGame(options(module));
    expect(result.end.kind).toBe("complete");
    const bids = decisions(result.transcript).filter((d) => d.inputId === "bid");
    expect(bids.some((d) => !Number.isInteger(d.value))).toBe(true);
    for (const bid of bids) {
      expect(bid.value as number).toBeGreaterThanOrEqual(0);
      expect(bid.value as number).toBeLessThanOrEqual(1);
    }
  });

  it("draws an unbounded number from 0 to 10", async () => {
    const module = highCard(addInput({ input: "bid", type: { kind: "number" } }));
    const result = await playGame(options(module));
    const bids = decisions(result.transcript).filter((d) => d.inputId === "bid");
    expect(bids.length).toBeGreaterThan(0);
    for (const bid of bids) {
      expect(bid.value as number).toBeGreaterThanOrEqual(0);
      expect(bid.value as number).toBeLessThanOrEqual(10);
    }
  });

  it("answers a string input with fixed text", async () => {
    const module = highCard(addInput({ input: "note", type: { kind: "string" } }));
    const result = await playGame(options(module));
    expect(result.end.kind).toBe("complete");
    expect(decisions(result.transcript).filter((d) => d.inputId === "note").map((d) => d.value)).not.toHaveLength(0);
    for (const note of decisions(result.transcript).filter((d) => d.inputId === "note")) {
      expect(note.value).toBe("playtest");
    }
  });

  it("retries a rejected generated value, then reports playtest-unsupported", async () => {
    const module = highCard(
      addInput({ input: "bid", type: { kind: "number", min: 1, max: 100 }, validation: "input.bid > 1000" }),
    );
    const result = await playGame(options(module));
    expect(result.end).toMatchObject({
      kind: "error",
      attribution: { code: "playtest-unsupported", category: "unsupported" },
      message: "playtest couldn't find an accepted value for input \"bid\"",
      input: { inputId: "bid" },
    });
    // Rejected attempts are not recorded as decisions.
    expect(decisions(result.transcript).filter((d) => d.inputId === "bid")).toHaveLength(0);
    expect(MAX_GENERATED_RETRIES).toBe(10);
  });

  it("accepts a value found on a retry", async () => {
    // Half of the draws are rejected, so games need retries but still finish.
    const module = highCard(
      addInput({ input: "bid", type: { kind: "number", min: 1, max: 100 }, validation: "input.bid > 50" }),
    );
    const result = await playGame(options(module));
    expect(result.end.kind).toBe("complete");
    for (const bid of decisions(result.transcript).filter((d) => d.inputId === "bid")) {
      expect(bid.value as number).toBeGreaterThan(50);
    }
  });
});

describe("playGame failures", () => {
  const base = highCard();

  it("classifies a runtime fault through the attribution table", async () => {
    const faulty: CompiledGameModule = {
      ...base,
      createSession: () => {
        throw new GameRuntimeError("no-legal-actions", "nothing to play");
      },
    };
    const result = await playGame(options(faulty));
    expect(result.end).toMatchObject({
      kind: "error",
      attribution: { code: "playtest-no-legal-actions", category: "spec" },
      message: "nothing to play",
    });
  });

  it("reports an unrecognized throw as runtime-error", async () => {
    const faulty: CompiledGameModule = {
      ...base,
      createSession: () => {
        throw new TypeError("boom");
      },
    };
    const result = await playGame(options(faulty));
    expect(result.end).toMatchObject({ kind: "error", attribution: { code: "runtime-error" }, message: "boom" });
  });

  it("reports playtest-unsupported for an input with no options and no generator", async () => {
    const module: CompiledGameModule = {
      ...base,
      createSession: (gameId, players, opts) => {
        const session = base.createSession(gameId, players, opts);
        // No hand inventory: the gamepiece-select has nothing to list.
        session.config = { ...session.config, inventories: {} } as typeof session.config;
        return session;
      },
    };
    const result = await playGame(options(module));
    expect(result.end).toMatchObject({
      kind: "error",
      attribution: { code: "playtest-unsupported", category: "unsupported" },
      message: "playtest can't generate a value for input \"card\" (kind \"gamepiece-select\")",
      input: { inputId: "card" },
    });
  });

  it("carries the node id of a step-budget fault", async () => {
    const faulty: CompiledGameModule = {
      ...base,
      createSession: () => {
        throw new StepBudgetExceededError(10, "loop-1");
      },
    };
    const result = await playGame(options(faulty));
    expect(result.end).toMatchObject({
      kind: "error",
      attribution: { code: "playtest-runaway" },
      nodeId: "loop-1",
    });
  });
});
