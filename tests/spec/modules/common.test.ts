/**
 * Parse tests for common schemas: IntRangeSchema, StatePathSchema.
 */

import { IntRangeSchema, StatePathSchema } from "#gamedef/modules/common.js";

// ---------------------------------------------------------------------------
// IntRangeSchema
// ---------------------------------------------------------------------------

describe("IntRangeSchema", () => {
  it("parses { min: 3, max: 3 } (exactly 3)", () => {
    expect(IntRangeSchema.parse({ min: 3, max: 3 })).toEqual({ min: 3, max: 3 });
  });

  it("parses { max: 3 } (up to 3)", () => {
    expect(IntRangeSchema.parse({ max: 3 })).toEqual({ max: 3 });
  });

  it("parses { min: 2 } (at least 2)", () => {
    expect(IntRangeSchema.parse({ min: 2 })).toEqual({ min: 2 });
  });

  it("parses {} (unbounded)", () => {
    expect(IntRangeSchema.parse({})).toEqual({});
  });

  it("rejects min < 0", () => {
    expect(IntRangeSchema.safeParse({ min: -1 }).success).toBe(false);
  });

  it("rejects max < 1", () => {
    expect(IntRangeSchema.safeParse({ max: 0 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// StatePathSchema — valid paths
// ---------------------------------------------------------------------------

describe("StatePathSchema — valid paths", () => {
  const valid = [
    "game.property.round",
    "game.property.activePlayers",
    "actor.property.score",
    "actor.property.alive",
    "actor.role.dealer",
    "actor.role.mafia-member",
    "piece.property.charges",
    "piece.property.face-state",
    "input.bidAmount",
    "input.target-player",
  ];

  for (const path of valid) {
    it(`accepts "${path}"`, () => {
      expect(StatePathSchema.safeParse(path).success).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// StatePathSchema — invalid paths
// ---------------------------------------------------------------------------

describe("StatePathSchema — invalid paths", () => {
  const invalid = [
    "",
    "score",                    // bare property name, no prefix
    "property.score",           // missing root segment
    "player.property.score",    // "player" not a valid root (use "actor")
    "game.score",               // missing "property" segment
    "actor.inventory",          // missing trailing id
    "game.inventory.discard",   // inventories are collections, not state paths
    "game.property.",           // empty id after prefix
    "GAME.property.round",      // wrong case
  ];

  for (const path of invalid) {
    it(`rejects "${path}"`, () => {
      expect(StatePathSchema.safeParse(path).success).toBe(false);
    });
  }
});
