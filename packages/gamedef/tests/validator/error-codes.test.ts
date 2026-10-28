import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { load } from "js-yaml";
import { validate } from "../../src/validator/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

type Raw = Record<string, any>;

const META = { name: "Test Game", playerCount: { min: 2, max: 2 } };

const DUMMY_TURN = {
  kind: "turn",
  actor: "all-players",
  grammar: { kind: "action", ref: "dummy" },
};

function loadHighCard(): Raw {
  return load(
    readFileSync(join(__dirname, "../../examples/high-card.yaml"), "utf-8"),
  ) as Raw;
}

describe("validation error codes", () => {
  it("baseline high-card is valid", () => {
    expect(validate(loadHighCard()).valid).toBe(true);
  });

  it("unresolved effectRef: code and exact knownIds", () => {
    const raw = loadHighCard();
    raw.actions.actions[0].steps.push({ effectRef: "dealCard" });

    const result = validate(raw);

    expect(result.errors).toEqual([
      {
        path: "actions.actions[0].steps[2].effectRef",
        message: 'Effect ref "dealCard" not found in effects module',
        code: "unresolved-ref",
        knownIds: [
          "announceStart",
          "announceTrick",
          "awardTrick",
          "clearTable",
          "dealCards",
          "fillDeck",
          "resetRoundWinner",
          "shuffleDeck",
        ],
      },
    ]);
  });

  it("unresolved catalog typeId: code and exact knownIds", () => {
    const raw = loadHighCard();
    raw.catalog.entries[0].typeId = "cardd";

    const result = validate(raw);

    expect(result.errors).toEqual([
      {
        path: "catalog.entries[0].typeId",
        message: 'Gamepiece type "cardd" not found in gamepieceTypes module',
        code: "unresolved-ref",
        knownIds: ["card"],
      },
    ]);
  });

  it("contract errors use invalid-ref-usage and carry no knownIds", () => {
    const raw = loadHighCard();
    raw.catalog.entries[0].properties = { bogus: 1 };

    const result = validate(raw);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe("invalid-ref-usage");
    expect(result.errors[0]).not.toHaveProperty("knownIds");
  });

  it("Zod errors use code schema", () => {
    const raw = loadHighCard();
    raw.metadata = 5;

    const result = validate(raw);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    for (const error of result.errors) expect(error.code).toBe("schema");
  });

  it("duplicate ids use code duplicate-id", () => {
    const raw = loadHighCard();
    raw.effects.effects.push(structuredClone(raw.effects.effects[0]));

    const result = validate(raw);

    expect(result.errors).toEqual([
      {
        path: "effects.effects",
        message: 'Duplicate ID "fillDeck" — IDs must be unique within this module',
        code: "duplicate-id",
      },
    ]);
  });

  it("loop without an exit condition uses code flow-integrity", () => {
    const result = validate({
      metadata: META,
      flow: { root: { kind: "game", children: [{ kind: "loop", children: [DUMMY_TURN] }] } },
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      path: "flow.root.children[0]",
      code: "flow-integrity",
    });
  });

  it("dice without a face table use code face-table", () => {
    const result = validate({
      metadata: META,
      gamepieceTypes: { types: [{ id: "die", category: "dice" }] },
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      path: "gamepieceTypes.types[0]",
      code: "face-table",
    });
  });

  it("actor-less hook selecting a player-scoped inventory uses code actor-context", () => {
    const result = validate({
      metadata: META,
      inventories: {
        types: [{ id: "hand", scope: { kind: "player" }, accepts: ["card"], visibility: "owner" }],
      },
      effects: {
        effects: [{ id: "rollHands", effect: "roll", pieces: { inventory: "hand", select: "all" } }],
      },
      flow: {
        root: {
          kind: "game",
          hooks: { onEnter: [{ effectRef: "rollHands" }] },
          children: [{ kind: "loop", count: 1, children: [DUMMY_TURN] }],
        },
      },
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      path: "flow.root.hooks.onEnter[0]",
      code: "actor-context",
    });
  });
});
