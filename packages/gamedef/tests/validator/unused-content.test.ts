/**
 * UnusedContentValidator — unused-effect, unused-action, unbound-passive, unbound-slot.
 */

import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { load } from "js-yaml";
import { validate } from "../../src/validator/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

type Raw = Record<string, any>;

const META = { name: "Test Game", playerCount: { min: 2, max: 2 } };

const effect = (id: string) => ({
  id,
  effect: "move",
  from: { inventory: "src", select: "top" },
  to: { inventory: "dst" },
});

const action = (id: string, extra: Raw = {}) => ({
  id,
  label: id,
  description: `${id} action`,
  steps: [{ effectRef: "used" }],
  ...extra,
});

const turn = (ref: string) => ({
  kind: "turn",
  actor: "all",
  grammar: { kind: "action", ref },
});

const flow = (children: Raw[], extra: Raw = {}) => ({
  root: { kind: "game", children: [{ kind: "loop", count: 1, children }], ...extra },
});

const passive = (id: string) => ({
  id,
  trigger: { kind: "state-write", scope: "target", path: "player.property.hp", direction: "decrease" },
  effects: [{ effect: "adjust", adjustment: { delta: 1 } }],
});

function spec(overrides: Raw = {}): Raw {
  return {
    metadata: META,
    effects: { effects: [effect("used")] },
    actions: { actions: [action("play")] },
    flow: flow([turn("play")]),
    ...overrides,
  };
}

function warningsFor(raw: Raw, code: string) {
  const result = validate(raw);
  expect(result.errors).toEqual([]);
  return result.warnings.filter((w) => w.code === code);
}

describe("unused-effect", () => {
  it("passes when effects are referenced by an action step", () => {
    expect(warningsFor(spec(), "unused-effect")).toEqual([]);
  });

  it("warns on a named effect nothing references, naming the id and path", () => {
    const raw = spec({ effects: { effects: [effect("used"), effect("orphan")] } });
    expect(warningsFor(raw, "unused-effect")).toEqual([
      expect.objectContaining({ path: "effects.effects[1]", severity: "warning", message: expect.stringContaining("orphan") }),
    ]);
  });

  it("counts flow hooks and onVictory as references", () => {
    const raw = spec({
      effects: { effects: [effect("used"), effect("onEnterFx"), effect("onCompleteFx"), effect("victoryFx")] },
      flow: flow([turn("play")], {
        hooks: { onEnter: [{ effectRef: "onEnterFx" }], onComplete: [{ effectRef: "onCompleteFx" }] },
        winConditions: [{ rule: "ranking", property: "player.property.score", onVictory: [{ effectRef: "victoryFx" }] }],
      }),
    });
    expect(warningsFor(raw, "unused-effect")).toEqual([]);
  });

  it("counts an interrupt window trigger and a reactive trigger as references", () => {
    const raw = spec({
      effects: { effects: [effect("used"), effect("windowFx"), effect("reactiveFx")] },
      actions: {
        actions: [
          action("play"),
          action("respond", { reactive: { trigger: "reactiveFx", timing: "after" } }),
        ],
      },
      flow: {
        root: {
          kind: "game",
          children: [
            {
              kind: "loop",
              count: 1,
              interruptWindows: [{ id: "w", trigger: "windowFx", timing: "after", eligiblePlayers: "all", actions: ["respond"] }],
              children: [turn("play")],
            },
          ],
        },
      },
    });
    expect(warningsFor(raw, "unused-effect")).toEqual([]);
  });

  it("is skipped when the flow module is absent", () => {
    const { flow: _flow, ...noFlow } = spec({ effects: { effects: [effect("used"), effect("orphan")] } });
    expect(warningsFor(noFlow, "unused-effect")).toEqual([]);
    expect(warningsFor(noFlow, "unused-action")).toEqual([]);
  });

  it("counts an effectRef inside an inline catalog action as a reference", () => {
    const raw = spec({
      effects: { effects: [effect("used"), effect("cardFx")] },
      gamepieceTypes: {
        types: [{ id: "card", category: "card", actionSlots: [{ id: "ability" }] }],
      },
      catalog: {
        entries: [{ typeId: "card", actionBindings: { ability: { steps: [{ effectRef: "cardFx" }] } } }],
      },
    });
    expect(warningsFor(raw, "unused-effect")).toEqual([]);
  });

  it("counts a reactive trigger on an inline catalog action as a reference", () => {
    const raw = spec({
      effects: { effects: [effect("used"), effect("reactiveFx")] },
      gamepieceTypes: {
        types: [{ id: "card", category: "card", actionSlots: [{ id: "ability" }] }],
      },
      catalog: {
        entries: [
          {
            typeId: "card",
            actionBindings: {
              ability: { steps: [{ effectRef: "used" }], reactive: { trigger: "reactiveFx", timing: "after" } },
            },
          },
        ],
      },
    });
    expect(warningsFor(raw, "unused-effect")).toEqual([]);
  });
});

describe("unused-action", () => {
  it("warns on an action no grammar references", () => {
    const raw = spec({ actions: { actions: [action("play"), action("orphan")] } });
    expect(warningsFor(raw, "unused-action")).toEqual([
      expect.objectContaining({ path: "actions.actions[1]", severity: "warning", message: expect.stringContaining("orphan") }),
    ]);
  });

  it("finds actions nested in sequence, choice and repeat grammar", () => {
    const raw = spec({
      actions: { actions: [action("a"), action("b"), action("c")] },
      flow: flow([
        {
          kind: "turn",
          actor: "all",
          grammar: {
            kind: "sequence",
            steps: [
              { kind: "action", ref: "a" },
              { kind: "repeat", count: 2, body: { kind: "choice", options: [{ kind: "action", ref: "b" }, { kind: "action", ref: "c" }] } },
            ],
          },
        },
      ]),
    });
    expect(warningsFor(raw, "unused-action")).toEqual([]);
  });

  it("counts catalog actionBindings and charges mechanic references", () => {
    const raw = spec({
      actions: { actions: [action("play"), action("bound"), action("charged")] },
      gamepieceTypes: {
        types: [
          {
            id: "card",
            category: "card",
            actionSlots: [{ id: "ability" }],
            mechanics: [
              { kind: "chaincraft:charges", slotId: "t:use", chargeType: "token", maxCharges: 1, count: 1, action: "charged" },
            ],
          },
        ],
      },
      catalog: { entries: [{ typeId: "card", actionBindings: { ability: "bound" } }] },
    });
    expect(warningsFor(raw, "unused-action")).toEqual([]);
  });

  it("skips actions that declare reactive or availableInSubflows", () => {
    const raw = spec({
      effects: { effects: [effect("used"), effect("fx")] },
      actions: {
        actions: [
          action("play"),
          action("r", { reactive: { trigger: "fx", timing: "after" } }),
          action("s", { availableInSubflows: ["play"] }),
        ],
      },
    });
    expect(warningsFor(raw, "unused-action")).toEqual([]);
  });

  it("counts an interrupt window's actions as references", () => {
    const raw = spec({
      effects: { effects: [effect("used"), effect("windowFx")] },
      actions: { actions: [action("play"), action("respond")] },
      flow: {
        root: {
          kind: "game",
          children: [
            {
              kind: "loop",
              count: 1,
              interruptWindows: [{ id: "w", trigger: "windowFx", timing: "after", eligiblePlayers: "all", actions: ["respond"] }],
              children: [turn("play")],
            },
          ],
        },
      },
    });
    expect(warningsFor(raw, "unused-action")).toEqual([]);
  });

  it("warns on an action that declares interrupt but is listed by no window", () => {
    const raw = spec({ actions: { actions: [action("play"), action("i", { interrupt: ["play"] })] } });
    expect(warningsFor(raw, "unused-action")).toEqual([
      expect.objectContaining({ path: "actions.actions[1]", message: expect.stringContaining("\"i\"") }),
    ]);
  });

  it("finds actions in simultaneous-node grammar", () => {
    const raw = spec({
      flow: flow([{ kind: "simultaneous", actor: "all", grammar: { kind: "action", ref: "play" } }]),
    });
    expect(warningsFor(raw, "unused-action")).toEqual([]);
  });

  it("warns on an unbound action when a catalog is present", () => {
    const raw = spec({
      actions: { actions: [action("play"), action("slotBound")] },
      gamepieceTypes: { types: [{ id: "card", category: "card", actionSlots: [{ id: "ability" }] }] },
      catalog: { entries: [{ typeId: "card" }] },
    });
    expect(warningsFor(raw, "unused-action")).toEqual([
      expect.objectContaining({ path: "actions.actions[1]", severity: "warning" }),
    ]);
  });

  it("is skipped when the catalog is absent and types declare action slots", () => {
    const raw = spec({
      actions: { actions: [action("play"), action("slotBound")] },
      gamepieceTypes: { types: [{ id: "card", category: "card", actionSlots: [{ id: "ability" }] }] },
    });
    expect(warningsFor(raw, "unused-action")).toEqual([]);
  });
});

describe("unbound-passive / unbound-slot", () => {
  const types = {
    types: [
      {
        id: "card",
        category: "card",
        passiveSlots: [
          { id: "slotA", enabledIn: ["field"] },
          { id: "slotB", enabledIn: ["field"] },
        ],
      },
    ],
  };

  it("are skipped when the catalog is absent", () => {
    const raw = spec({ effects: { effects: [effect("used")], passives: [passive("p1")] }, gamepieceTypes: types });
    expect(warningsFor(raw, "unbound-passive")).toEqual([]);
    expect(warningsFor(raw, "unbound-slot")).toEqual([]);
  });

  it("warn on a passive no catalog entry binds and a slot no entry fills", () => {
    const raw = spec({
      effects: { effects: [effect("used")], passives: [passive("bound"), passive("loose")] },
      gamepieceTypes: types,
      catalog: { entries: [{ typeId: "card", passiveBindings: { slotA: "bound" } }] },
    });
    expect(warningsFor(raw, "unbound-passive")).toEqual([
      expect.objectContaining({ path: "effects.passives[1]", severity: "warning", message: expect.stringContaining("loose") }),
    ]);
    expect(warningsFor(raw, "unbound-slot")).toEqual([
      expect.objectContaining({
        path: "gamepieceTypes.types[0].passiveSlots[1]",
        severity: "warning",
        message: expect.stringContaining("slotB"),
      }),
    ]);
  });

  it("warns on every slot of a type that no catalog entry uses", () => {
    const raw = spec({
      gamepieceTypes: { types: [...types.types, { id: "token", category: "token" }] },
      catalog: { entries: [{ typeId: "token" }] },
    });
    expect(warningsFor(raw, "unbound-slot").map((w) => w.path)).toEqual([
      "gamepieceTypes.types[0].passiveSlots[0]",
      "gamepieceTypes.types[0].passiveSlots[1]",
    ]);
  });

  it("merges bindings across catalog entries of the same type", () => {
    const raw = spec({
      effects: { effects: [effect("used")], passives: [passive("pa"), passive("pb")] },
      gamepieceTypes: types,
      catalog: {
        entries: [
          { typeId: "card", passiveBindings: { slotA: "pa" } },
          { typeId: "card", passiveBindings: { slotB: "pb" } },
        ],
      },
    });
    expect(warningsFor(raw, "unbound-slot")).toEqual([]);
    expect(warningsFor(raw, "unbound-passive")).toEqual([]);
  });

  it("treat an inline binding as filling its slot", () => {
    const { id: _id, ...inline } = passive("x");
    const raw = spec({
      gamepieceTypes: types,
      catalog: { entries: [{ typeId: "card", passiveBindings: { slotA: inline, slotB: inline } }] },
    });
    expect(warningsFor(raw, "unbound-slot")).toEqual([]);
  });
});

describe("warnings do not affect validity", () => {
  it("keeps valid true and leaves errors empty", () => {
    const result = validate(spec({ effects: { effects: [effect("used"), effect("orphan")] } }));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([expect.objectContaining({ code: "unused-effect", severity: "warning" })]);
  });

  it("reports warnings alongside errors on an invalid spec", () => {
    const raw = spec({ effects: { effects: [effect("used"), effect("orphan")] } });
    raw.actions.actions[0].steps.push({ effectRef: "missing" });
    const result = validate(raw);
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.code)).toEqual(["unresolved-ref"]);
    expect(result.warnings.map((w) => w.code)).toEqual(["unused-effect"]);
  });
});

describe("example specs", () => {
  const dir = join(__dirname, "../../examples");
  const loaded = readdirSync(dir, { recursive: true, encoding: "utf-8" })
    .filter((f) => f.endsWith(".yaml"))
    .map((file) => ({ file, result: validate(load(readFileSync(join(dir, file), "utf-8"))) }));
  // Legacy-format files under memory/ and spades/ are not valid specs today; the examples suite covers validity.
  const valid = loaded.filter((e) => e.result.valid);
  const EXPECTED_INVALID = [
    "board-battler-v18.yaml",
    "memory/memory.yaml",
    "memory/memory_deck.yaml",
    "passive-battler.yaml",
    "spades/spades.yaml",
    "standard_deck.yaml",
  ];

  it("skips only the known-invalid examples", () => {
    expect(loaded.filter((e) => !e.result.valid).map((e) => e.file).sort()).toEqual(EXPECTED_INVALID);
  });

  it("covers the full-spec examples", () => {
    expect(valid.map((e) => e.file)).toEqual(expect.arrayContaining(["high-card.yaml", "liars-dice.yaml"]));
  });

  it.each(valid.map((e) => [e.file, e.result.warnings] as const))("%s has no dead-content warnings", (_file, warnings) => {
    expect(warnings.map((w) => `${w.code} ${w.path}: ${w.message}`)).toEqual([]);
  });
});
