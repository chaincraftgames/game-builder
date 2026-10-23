/**
 * Validator integration tests — duplicate IDs, flow termination, reference checks
 */

import { describe, expect, it } from "@jest/globals";
import { validate } from "../../src/validator/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid metadata */
const META = { name: "Test Game", playerCount: { min: 2, max: 2 } };

/** A Zod-valid named effect (move, no description required) */
function makeEffect(id: string) {
  return {
    id,
    effect: "move",
    from: { inventory: "src", select: "top" },
    to: { inventory: "dst" },
  };
}

/** A Zod-valid action */
function makeAction(id: string, effectRef?: string) {
  return {
    id,
    label: id,
    description: `${id} action`,
    steps: [{ effectRef: effectRef ?? id }],
  };
}

/** A minimal valid turn node (no availableActions) */
const DUMMY_TURN = {
  kind: "turn",
  actor: "all-players",
  grammar: { kind: "action", ref: "dummy" },
};

/** A Zod-valid root game node wrapping a single loop with count=1 */
function makeGameRoot(overrides: Record<string, unknown> = {}) {
  return { kind: "game", children: [{ kind: "loop", count: 1, children: [DUMMY_TURN] }], ...overrides };
}

/** A Zod-valid loop node with count=1 */
function makeLoop(overrides: Record<string, unknown> = {}) {
  return { kind: "loop", count: 1, children: [DUMMY_TURN], ...overrides };
}

/** Minimal valid inventory type */
function makeInventory(id: string) {
  return {
    id,
    scope: { kind: "game" },
    accepts: ["anyPiece"],
    visibility: "always",
  };
}

/** Minimal valid gamepiece type */
function makePiecetype(id: string) {
  return { id, category: "token" };
}

function minimalSpec(overrides: Record<string, unknown> = {}) {
  return { metadata: META, ...overrides };
}

// ---------------------------------------------------------------------------
// Pass 1 — Reference resolution
// ---------------------------------------------------------------------------

describe("Reference resolution", () => {
  it("passes when effect ref exists", () => {
    const result = validate(
      minimalSpec({
        effects: { effects: [makeEffect("myEffect")] },
        actions: {
          actions: [makeAction("myAction", "myEffect")],
        },
      }),
    );
    expect(result.errors.filter((e) => e.path.includes("ref"))).toHaveLength(0);
  });

  it("errors when effect ref is missing", () => {
    const result = validate(
      minimalSpec({
        effects: { effects: [makeEffect("myEffect")] },
        actions: {
          actions: [makeAction("myAction", "nonexistentEffect")],
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("nonexistentEffect"))).toBe(true);
  });

  it("errors when catalog typeId not in gamepieceTypes", () => {
    const result = validate(
      minimalSpec({
        catalog: {
          entries: [{ typeId: "ghostType", quantity: 1 }],
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("ghostType"))).toBe(true);
  });

  it("errors when dominant-gamepiece evaluationInventory not in inventories", () => {
    const result = validate(
      minimalSpec({
        mechanics: [
          {
            kind: "chaincraft:dominant-gamepiece",
            evaluationInventory: "nonexistentPile",
            winnerToState: "game.property.roundWinner",
            rules: [
              {
                kind: "matrix",
                property: "rps",
                beats: { rock: ["scissors"], paper: ["rock"], scissors: ["paper"] },
              },
            ],
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("nonexistentPile"))).toBe(true);
  });

  it("passes when dominant-gamepiece evaluationInventory exists", () => {
    const result = validate(
      minimalSpec({
        inventories: { types: [makeInventory("trickPile")] },
        mechanics: [
          {
            kind: "chaincraft:dominant-gamepiece",
            evaluationInventory: "trickPile",
            winnerToState: "game.property.roundWinner",
            rules: [
              { kind: "comparison", property: "rank", order: ["2", "3", "A"], direction: "highest" },
            ],
          },
        ],
      }),
    );
    const dominantGamepieceErrors = result.errors.filter((e) => e.path.includes("evaluationInventory"));
    expect(dominantGamepieceErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Pass 2 — Duplicate ID detection
// ---------------------------------------------------------------------------

describe("Duplicate ID detection", () => {
  it("errors on duplicate action IDs", () => {
    const result = validate(
      minimalSpec({
        effects: { effects: [makeEffect("e1"), makeEffect("e2")] },
        actions: {
          actions: [makeAction("bid", "e1"), makeAction("bid", "e2")],
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('"bid"'))).toBe(true);
  });

  it("errors on duplicate effect IDs", () => {
    const result = validate(
      minimalSpec({
        effects: {
          effects: [makeEffect("score"), makeEffect("score")],
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('"score"'))).toBe(true);
  });

  it("errors on duplicate inventory type IDs", () => {
    const result = validate(
      minimalSpec({
        inventories: { types: [makeInventory("hand"), makeInventory("hand")] },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('"hand"'))).toBe(true);
  });

  it("errors on duplicate flow node IDs", () => {
    const result = validate(
      minimalSpec({
        flow: {
          root: {
            kind: "game",
            children: [
              { kind: "loop", id: "phaseA", count: 3, children: [DUMMY_TURN] },
              { kind: "loop", id: "phaseA", count: 3, children: [DUMMY_TURN] },
            ],
          },
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('"phaseA"'))).toBe(true);
  });

  it("passes when all IDs are unique", () => {
    const result = validate(
      minimalSpec({
        effects: { effects: [makeEffect("e1"), makeEffect("e2")] },
        actions: {
          actions: [makeAction("bid", "e1"), makeAction("challenge", "e2")],
        },
      }),
    );
    const dupErrors = result.errors.filter((e) => e.message.includes("Duplicate"));
    expect(dupErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Pass 3 — Flow structural integrity
// ---------------------------------------------------------------------------

describe("Flow structural integrity", () => {
  it("errors when root is not kind: game", () => {
    const result = validate(
      minimalSpec({
        flow: { root: { kind: "loop", count: 1, children: [DUMMY_TURN] } },
      }),
    );
    expect(result.valid).toBe(false);
  });

  it("errors when child loop has no exit condition", () => {
    const result = validate(
      minimalSpec({
        flow: { root: { kind: "game", children: [{ kind: "loop", children: [DUMMY_TURN] }] } },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("no exit condition"))).toBe(true);
  });

  it("passes when child loop has endCondition", () => {
    const result = validate(
      minimalSpec({
        flow: {
          root: {
            kind: "game",
            children: [
              { kind: "loop", endCondition: "game.property.gameOver == true", children: [DUMMY_TURN] },
            ],
          },
        },
      }),
    );
    const flowErrors = result.errors.filter((e) => e.message.includes("no exit condition"));
    expect(flowErrors).toHaveLength(0);
  });

  it("passes when child loop has count", () => {
    const result = validate(
      minimalSpec({
        flow: { root: makeGameRoot() },
      }),
    );
    const flowErrors = result.errors.filter((e) => e.message.includes("no exit condition"));
    expect(flowErrors).toHaveLength(0);
  });

  it("passes when score-track mechanic with winAt auto-wires end condition", () => {
    const result = validate(
      minimalSpec({
        mechanics: [
          {
            kind: "chaincraft:score-track",
            trackLength: 10,
            scoringProperty: "score",
            scope: "player",
            winAt: 10,
          },
        ],
        flow: { root: { kind: "game", children: [{ kind: "loop", children: [DUMMY_TURN] }] } },
      }),
    );
    const flowErrors = result.errors.filter((e) => e.message.includes("no exit condition"));
    expect(flowErrors).toHaveLength(0);
  });

  it("errors on nested loop with no exit condition", () => {
    const result = validate(
      minimalSpec({
        flow: {
          root: {
            kind: "game",
            children: [
              {
                kind: "loop",
                count: 1,
                children: [
                  {
                    kind: "loop",
                    id: "inner",
                    // no endCondition, no count
                    children: [DUMMY_TURN],
                  },
                ],
              },
            ],
          },
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("no exit condition"))).toBe(true);
  });

  it("errors when flow has no root node", () => {
    const result = validate(
      minimalSpec({
        flow: { root: undefined },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "flow.root")).toBe(true);
  });

  it("errors when availableInSubflows references non-existent node ID", () => {
    const result = validate(
      minimalSpec({
        flow: { root: makeGameRoot() },
        effects: { effects: [makeEffect("useE")] },
        actions: {
          actions: [makeAction("useAbility", "useE")],
        },
        gamepieceTypes: {
          types: [
            {
              ...makePiecetype("card"),
              mechanics: [
                {
                  kind: "chaincraft:charges",
                  slotId: "mygame:ability",
                  chargeType: "energy",
                  maxCharges: 3,
                  count: 1,
                  action: "useAbility",
                  availableInSubflows: ["nonexistentPhase"],
                },
              ],
            },
          ],
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("nonexistentPhase"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Catalog binding validation
// ---------------------------------------------------------------------------

describe("Catalog binding validation", () => {
  it("errors when actionBindings references non-existent action", () => {
    const result = validate(
      minimalSpec({
        gamepieceTypes: {
          types: [{ ...makePiecetype("card"), actionSlots: [{ id: "playEffect" }] }],
        },
        catalog: {
          entries: [{ typeId: "card", actionBindings: { "playEffect": "nonexistentAction" } }],
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("nonexistentAction"))).toBe(true);
  });

  it("errors when actionBindings key does not match an actionSlot", () => {
    const result = validate(
      minimalSpec({
        effects: { effects: [makeEffect("e1")] },
        actions: { actions: [makeAction("playStrike", "e1")] },
        gamepieceTypes: {
          types: [{ ...makePiecetype("card"), actionSlots: [{ id: "playEffect" }] }],
        },
        catalog: {
          entries: [{ typeId: "card", actionBindings: { "badSlot": "playStrike" } }],
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("badSlot"))).toBe(true);
  });

  it("passes when actionBindings key and value are valid", () => {
    const result = validate(
      minimalSpec({
        effects: { effects: [makeEffect("e1")] },
        actions: { actions: [makeAction("playStrike", "e1")] },
        gamepieceTypes: {
          types: [{ ...makePiecetype("card"), actionSlots: [{ id: "playEffect" }] }],
        },
        catalog: {
          entries: [{ typeId: "card", actionBindings: { "playEffect": "playStrike" } }],
        },
      }),
    );
    const bindingErrors = result.errors.filter((e) => e.path.includes("actionBindings"));
    expect(bindingErrors).toHaveLength(0);
  });

  it("errors when passiveBindings references non-existent passive", () => {
    const result = validate(
      minimalSpec({
        effects: { effects: [makeEffect("e1")] },
        gamepieceTypes: {
          types: [{ ...makePiecetype("equipment"), passiveSlots: [{ id: "wornPassive", enabledIn: ["equipped"] }] }],
        },
        catalog: {
          entries: [{ typeId: "equipment", passiveBindings: { "wornPassive": "nonexistentPassive" } }],
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("nonexistentPassive"))).toBe(true);
  });

  it("errors when passiveBindings key does not match a passiveSlot", () => {
    const result = validate(
      minimalSpec({
        effects: {
          effects: [makeEffect("e1")],
          passives: [{
            id: "armorAbsorb",
            trigger: { kind: "state-write", scope: "target", path: "player.property.hp", direction: "decrease" },
            effects: [{ effect: "cancel-effect" }],
          }],
        },
        gamepieceTypes: {
          types: [{ ...makePiecetype("equipment"), passiveSlots: [{ id: "wornPassive", enabledIn: ["equipped"] }] }],
        },
        catalog: {
          entries: [{ typeId: "equipment", passiveBindings: { "badSlot": "armorAbsorb" } }],
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("badSlot"))).toBe(true);
  });

  it("passes when passiveBindings key and value are valid", () => {
    const result = validate(
      minimalSpec({
        effects: {
          effects: [makeEffect("e1")],
          passives: [{
            id: "armorAbsorb",
            trigger: { kind: "state-write", scope: "target", path: "player.property.hp", direction: "decrease" },
            effects: [{ effect: "cancel-effect" }],
          }],
        },
        gamepieceTypes: {
          types: [{ ...makePiecetype("equipment"), passiveSlots: [{ id: "wornPassive", enabledIn: ["equipped"] }] }],
        },
        catalog: {
          entries: [{ typeId: "equipment", passiveBindings: { "wornPassive": "armorAbsorb" } }],
        },
      }),
    );
    const bindingErrors = result.errors.filter((e) => e.path.includes("passiveBindings"));
    expect(bindingErrors).toHaveLength(0);
  });

  it("allows inline action binding (skips action ID ref check)", () => {
    const result = validate(
      minimalSpec({
        effects: { effects: [makeEffect("e1")] },
        gamepieceTypes: {
          types: [{ ...makePiecetype("card"), actionSlots: [{ id: "playEffect" }] }],
        },
        catalog: {
          entries: [{
            typeId: "card",
            actionBindings: {
              "playEffect": { label: "Inline Play", steps: [{ effectRef: "e1" }] },
            },
          }],
        },
      }),
    );
    const bindingErrors = result.errors.filter((e) => e.path.includes("actionBindings"));
    expect(bindingErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Catalog property source
// ---------------------------------------------------------------------------

describe("Catalog property source validation", () => {
  const creatureType = {
    ...makePiecetype("creature"),
    properties: [
      { id: "power", type: { kind: "number" }, mutable: true, visibility: "always" },
      { id: "frozen", type: { kind: "boolean" }, mutable: true, source: "runtime", default: false, visibility: "always" },
    ],
  };

  it("passes when the catalog sets only catalog-source properties", () => {
    const result = validate(
      minimalSpec({
        gamepieceTypes: { types: [creatureType] },
        catalog: { entries: [{ typeId: "creature", properties: { power: 3 } }] },
      }),
    );
    expect(result.errors.filter((e) => e.path.includes("properties"))).toHaveLength(0);
  });

  it("errors when the catalog sets a source: runtime property", () => {
    const result = validate(
      minimalSpec({
        gamepieceTypes: { types: [creatureType] },
        catalog: { entries: [{ typeId: "creature", properties: { frozen: true } }] },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("source: runtime"))).toBe(true);
  });

  it("errors when the catalog sets an undeclared property", () => {
    const result = validate(
      minimalSpec({
        gamepieceTypes: { types: [creatureType] },
        catalog: { entries: [{ typeId: "creature", properties: { bogus: 1 } }] },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("bogus"))).toBe(true);
  });

  it("errors when a source: runtime property is not mutable", () => {
    const result = validate(
      minimalSpec({
        gamepieceTypes: {
          types: [{
            ...makePiecetype("creature"),
            properties: [{ id: "x", type: { kind: "boolean" }, mutable: false, source: "runtime", visibility: "always" }],
          }],
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("mutable: false"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Duplicate passive IDs
// ---------------------------------------------------------------------------

describe("Duplicate passive ID detection", () => {
  it("errors on duplicate passive IDs", () => {
    const result = validate(
      minimalSpec({
        effects: {
          effects: [makeEffect("e1")],
          passives: [
            { id: "armor", trigger: { kind: "state-write", scope: "target", path: "player.property.hp", direction: "decrease" }, effects: [{ effect: "cancel-effect" }] },
            { id: "armor", trigger: { kind: "state-write", scope: "actor", path: "player.property.hp", direction: "decrease" }, effects: [{ effect: "cancel-effect" }] },
          ],
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('"armor"'))).toBe(true);
  });
});
