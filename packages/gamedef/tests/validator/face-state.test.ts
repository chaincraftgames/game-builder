import { describe, expect, it } from "@jest/globals";
import { validate } from "../../src/validator/index.js";

const META = { name: "Test Game", playerCount: { min: 2, max: 2 } };

const VALUE_PROPERTY = {
  id: "value",
  type: { kind: "number" },
  mutable: false,
  visibility: "revealed",
};

function specWith(options: {
  hasFaceState?: boolean;
  accepts?: string[];
  flip?: Record<string, unknown>;
}) {
  return {
    metadata: META,
    gamepieceTypes: {
      types: [
        { id: "card", category: "card", hasFaceState: options.hasFaceState ?? false, properties: [VALUE_PROPERTY] },
        { id: "token", category: "token" },
      ],
    },
    inventories: {
      types: [
        {
          id: "tray",
          scope: { kind: "game" },
          accepts: options.accepts ?? ["card"],
          visibility: "always",
        },
      ],
    },
    effects: options.flip
      ? { effects: [{ id: "flipTray", effect: "flip", to: "face-up", pieces: options.flip }] }
      : undefined,
  };
}

describe("FaceStateValidator", () => {
  it("rejects a revealed property on a type without face state", () => {
    const result = validate(specWith({}));
    expect(result.errors).toEqual([
      expect.objectContaining({
        path: "gamepieceTypes.types[0].properties[0]",
        code: "face-state",
        message: expect.stringContaining('"always"'),
      }),
    ]);
  });

  it("accepts a revealed property on a type with face state", () => {
    expect(validate(specWith({ hasFaceState: true })).valid).toBe(true);
  });

  it("rejects a flip of an inventory that accepts only types without face state", () => {
    const result = validate(
      specWith({ hasFaceState: false, flip: { inventory: "tray", select: "all" } }),
    );
    const flipErrors = result.errors.filter((e) => e.path === "effects.effects[0]");
    expect(flipErrors).toEqual([
      expect.objectContaining({ code: "face-state", message: expect.stringContaining("nothing to flip") }),
    ]);
  });

  it("rejects a flip with ofType naming a type without face state", () => {
    const result = validate(
      specWith({ hasFaceState: true, accepts: ["card", "token"], flip: { inventory: "tray", select: "all", ofType: "token" } }),
    );
    expect(result.errors).toEqual([
      expect.objectContaining({ path: "effects.effects[0]", code: "face-state" }),
    ]);
  });

  it("accepts a flip when the inventory also accepts a type with face state", () => {
    const result = validate(
      specWith({ hasFaceState: true, accepts: ["card", "token"], flip: { inventory: "tray", select: "all" } }),
    );
    expect(result.valid).toBe(true);
  });

  it("accepts a flip of a type with face state", () => {
    const result = validate(
      specWith({ hasFaceState: true, flip: { inventory: "tray", select: "all" } }),
    );
    expect(result.valid).toBe(true);
  });

  it("does not check flips whose types cannot be known", () => {
    const result = validate(
      specWith({ hasFaceState: true, flip: { inventory: "game:unassigned", select: "all" } }),
    );
    expect(result.valid).toBe(true);
  });

  it("finds a flip inside an action step", () => {
    const raw = specWith({ hasFaceState: false }) as Record<string, any>;
    raw.gamepieceTypes.types[0].properties = [];
    raw.actions = {
      actions: [
        {
          id: "turnOver",
          steps: [{ effect: "flip", to: "toggle", pieces: { inventory: "tray", select: "top" } }],
        },
      ],
    };
    const result = validate(raw);
    expect(result.errors).toEqual([
      expect.objectContaining({ path: "actions.actions[0].steps[0]", code: "face-state" }),
    ]);
  });

  it("does not flag reveal on a type without face state", () => {
    const raw = specWith({ hasFaceState: false }) as Record<string, any>;
    raw.gamepieceTypes.types[0].properties = [];
    raw.effects = {
      effects: [{ id: "show", effect: "reveal", to: "all", pieces: { inventory: "tray", select: "all" } }],
    };
    expect(validate(raw).errors).toEqual([]);
  });
});
