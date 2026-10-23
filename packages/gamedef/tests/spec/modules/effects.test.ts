/**
 * Parse tests for EffectsModuleSchema.
 *
 * "Liar's Dice" — bluffing dice game.
 * Exercises every effect kind and the full call-site machinery:
 *   - move (draw, discard, steal)
 *   - flip (reveal dice)
 *   - update (score, property delta, toggle, param ref)
 *   - shuffle
 *   - distribute (deal dice to players)
 *   - roll
 *   - orient
 *   - prose (escape hatch)
 *   - cancel-effect (reactive negate)
 *   - NamedEffectSchema (id required)
 *   - EffectSchema (anonymous inline, no id)
 *   - EffectCallRefSchema ({ effectRef })
 *   - EffectCallSchema keyed union (effectRef or inline effect)
 *   - EffectCallsSchema (min 1)
 *   - PieceSelectorSchema (all select variants including { id })
 *   - DistributeTargetSchema (roles filter)
 *   - PropertyValueSchema (literal, delta, toggle, param)
 *   - InventoryPlacementSchema (stack-top, stack-bottom, line-index, grid-cell)
 */

import {
  EffectsModuleSchema,
  EffectCallSchema,
  EffectCallsSchema,
  EffectCallRefSchema,
  EffectSchema,
  LlmEffectSchema,
  LlmInputSchema,
} from "#gamedef/modules/effects.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(data: unknown) {
  const result = EffectsModuleSchema.safeParse(data);
  if (!result.success) throw new Error(JSON.stringify(result.error.format(), null, 2));
  return result.data;
}

function fail(data: unknown) {
  const result = EffectsModuleSchema.safeParse(data);
  expect(result.success).toBe(false);
}

// ---------------------------------------------------------------------------
// Valid: full Liar's Dice effects module
// ---------------------------------------------------------------------------

describe("EffectsModuleSchema — Liar's Dice", () => {
  const validModule = {
    effects: [
      // move: draw dice from cup to player tray
      {
        id: "drawDie",
        effect: "move",
        from: { inventory: "diceCup", select: "top" },
        to: { inventory: "playerTray" },
      },

      // move: discard a die (deterministic selection; player choice handled via action input)
      {
        id: "discardDie",
        effect: "move",
        from: { inventory: "playerTray", select: "random", count: 1 },
        to: { inventory: "discardPile", at: { kind: "stack-top" } },
      },

      // move: steal a die from another player (random selection)
      {
        id: "stealDie",
        effect: "move",
        from: { inventory: "opponentTray", select: "random", count: 1 },
        to: { inventory: "playerTray" },
      },

      // move: move all dice to specific indexed position
      {
        id: "stackDice",
        effect: "move",
        from: { inventory: "playerTray", select: "all" },
        to: { inventory: "displayRack", at: { kind: "line-index", index: 0 } },
      },

      // move: place die at a row+col position (grid inventory)
      {
        id: "placeOnGrid",
        effect: "move",
        from: { inventory: "playerTray", select: "top" },
        to: { inventory: "gridBoard", at: { kind: "grid-cell", row: 1, col: 2 } },
      },

      // flip: reveal all dice in player tray
      {
        id: "revealDice",
        effect: "flip",
        pieces: { inventory: "playerTray", select: "all" },
        to: "face-up",
      },

      // flip: hide a single die
      {
        id: "hideDie",
        effect: "flip",
        pieces: { inventory: "playerTray", select: "top" },
        to: "face-down",
      },

      // update: increment score by 1 (delta)
      {
        id: "scorePoint",
        effect: "update",
        pieces: { inventory: "scoreTracker", select: "top" },
        property: "points",
        value: { delta: 1 },
      },

      // update: set score to literal 0
      {
        id: "resetScore",
        effect: "update",
        pieces: { inventory: "scoreTracker", select: "top" },
        property: "points",
        value: 0,
      },

      // update: toggle a boolean flag
      {
        id: "toggleActive",
        effect: "update",
        pieces: { inventory: "playerMarkers", select: "top" },
        property: "isActive",
        value: { toggle: true },
      },

      // update: set string property
      {
        id: "markChallenger",
        effect: "update",
        pieces: { inventory: "playerMarkers", select: "top" },
        property: "status",
        value: "challenger",
      },

      // update: set boolean property to literal true
      {
        id: "markEliminated",
        effect: "update",
        pieces: { inventory: "playerMarkers", select: "top" },
        property: "eliminated",
        value: true,
      },

      // shuffle: randomise the dice cup
      {
        id: "shuffleCup",
        effect: "shuffle",
        inventory: "diceCup",
      },

      // distribute: deal 5 dice to each player
      {
        id: "dealDice",
        effect: "distribute",
        from: { inventory: "diceCup", select: "top" },
        to: { scope: "all-players", inventory: "playerTray" },
        count: 5,
      },

      // distribute: deal to active player only
      {
        id: "dealExtraDie",
        effect: "distribute",
        from: { inventory: "diceCup", select: "top" },
        to: { scope: "active-player", inventory: "playerTray" },
        count: 1,
      },

      // roll: roll all dice in a player's tray
      {
        id: "rollAllDice",
        effect: "roll",
        pieces: { inventory: "playerTray", select: "all" },
      },

      // roll: roll a specific count
      {
        id: "rollTwoDice",
        effect: "roll",
        pieces: { inventory: "playerTray", select: "random", count: 2 },
      },

      // orient: rotate a tile clockwise
      {
        id: "rotateTile",
        effect: "orient",
        pieces: { inventory: "boardTiles", select: "top" },
        to: "rotate-cw",
      },

      // custom: complex resolution logic
      {
        id: "resolveChallenge",
        effect: "custom",
        description:
          "Count all dice showing the bid face value across all players. " +
          "If the total meets or exceeds the bid quantity, the challenger loses one die. " +
          "If the total is less, the bidder loses one die. " +
          "Any player with zero dice remaining is eliminated.",
      },

      // cancel-effect: reactive negate
      {
        id: "blockSteal",
        effect: "cancel-effect",
      },

      // move: ofType filter
      {
        id: "removeWildcards",
        effect: "move",
        from: { inventory: "playerTray", select: "all", ofType: "wildcardDie" },
        to: { inventory: "discardPile" },
      },
    ],
  };

  it("parses a valid full module without errors", () => {
    const result = ok(validModule);
    expect(result.effects).toHaveLength(21);
  });

  it("preserves effect ids", () => {
    const result = ok(validModule);
    const ids = result.effects.map((e) => e.id);
    expect(ids).toContain("resolveChallenge");
    expect(ids).toContain("dealDice");
    expect(ids).toContain("blockSteal");
  });

  it("parses move effect with bottom select", () => {
    const result = ok({
      effects: [
        {
          id: "buryCard",
          effect: "move",
          from: { inventory: "playerHand", select: "top" },
          to: { inventory: "drawDeck", at: { kind: "stack-bottom" } },
        },
      ],
    });
    expect(result.effects[0].effect).toBe("move");
  });

  it("parses flip effect with toggle", () => {
    const result = ok({
      effects: [
        {
          id: "toggleCard",
          effect: "flip",
          pieces: { inventory: "playArea", select: "top" },
          to: "toggle",
        },
      ],
    });
    expect(result.effects[0].effect).toBe("flip");
  });

  it("parses orient effect with specific index", () => {
    const result = ok({
      effects: [
        {
          id: "setOrientation",
          effect: "orient",
          pieces: { inventory: "boardTiles", select: "top" },
          to: 2,
        },
      ],
    });
    expect(result.effects[0].effect).toBe("orient");
  });

  it("parses update effect with { param } value", () => {
    // { param } is valid in EffectSchema (anonymous), not in NamedEffectSchema
    // because named effects are self-contained — params are for inline call-site effects
    const result = EffectSchema.safeParse({
      effect: "update",
      pieces: { inventory: "currentBid", select: "top" },
      property: "quantity",
      value: { param: "quantity" },
    });
    expect(result.success).toBe(true);
  });

  it("parses cancel-effect as named effect", () => {
    const result = ok({
      effects: [{ id: "negateAttack", effect: "cancel-effect" }],
    });
    expect(result.effects[0].effect).toBe("cancel-effect");
  });

  it("parses distribute to all-teams scope", () => {
    const result = ok({
      effects: [
        {
          id: "dealTeamCards",
          effect: "distribute",
          from: { inventory: "drawDeck", select: "top" },
          to: { scope: "all-teams", inventory: "teamHand" },
          count: 3,
        },
      ],
    });
    expect(result.effects[0].effect).toBe("distribute");
  });

  it("parses distribute with roles filter (setup: deal kill-card to mafia only)", () => {
    const result = ok({
      effects: [
        {
          id: "dealKillCard",
          effect: "distribute",
          from: { inventory: "game:unassigned", select: "top", ofType: "killCard" },
          to: { scope: "all-players", inventory: "playerHand", roles: ["mafia"] },
          count: 1,
        },
      ],
    });
    expect(result.effects[0].effect).toBe("distribute");
    expect((result.effects[0] as any).to.roles).toEqual(["mafia"]);
  });
});

// ---------------------------------------------------------------------------
// select: { id } — named piece targeting
// ---------------------------------------------------------------------------

describe("EffectsModuleSchema — select by id", () => {
  it("parses move with select: { id } for named catalog piece", () => {
    const result = ok({
      effects: [
        {
          id: "placeWhiteKing",
          effect: "move",
          from: { inventory: "game:unassigned", select: { id: "whiteKing" } },
          to: { inventory: "board", at: { kind: "grid-cell", row: 1, col: "e" } },
        },
      ],
    });
    expect(result.effects[0].effect).toBe("move");
    expect((result.effects[0] as any).from.select).toEqual({ id: "whiteKing" });
  });

  it("parses flip with select: { id }", () => {
    const result = ok({
      effects: [
        {
          id: "revealKing",
          effect: "flip",
          pieces: { inventory: "game:unassigned", select: { id: "whiteKing" } },
          to: "face-up",
        },
      ],
    });
    expect((result.effects[0] as any).pieces.select).toEqual({ id: "whiteKing" });
  });
});

// ---------------------------------------------------------------------------
// Rejections
// ---------------------------------------------------------------------------

describe("EffectsModuleSchema — rejections", () => {
  it("rejects an empty effects array", () => {
    fail({ effects: [] });
  });

  it("rejects a named effect missing id", () => {
    fail({
      effects: [
        {
          effect: "shuffle",
          inventory: "drawDeck",
          // missing id
        },
      ],
    });
  });

  it("rejects an unknown effect kind", () => {
    fail({
      effects: [{ id: "x", effect: "teleport", inventory: "deck" }],
    });
  });

  it("rejects move effect missing 'from'", () => {
    fail({
      effects: [
        {
          id: "badMove",
          effect: "move",
          to: { inventory: "playerHand" },
        },
      ],
    });
  });

  it("rejects update effect missing 'property'", () => {
    fail({
      effects: [
        {
          id: "badUpdate",
          effect: "update",
          pieces: { inventory: "scoreTracker", select: "top" },
          value: 1,
        },
      ],
    });
  });

  it("rejects distribute with unknown scope", () => {
    fail({
      effects: [
        {
          id: "badDistribute",
          effect: "distribute",
          from: { inventory: "deck", select: "top", count: 3 },
          to: { scope: "everyone", inventory: "hand" },
        },
      ],
    });
  });

  it("rejects piece selector with unknown select value", () => {
    fail({
      effects: [
        {
          id: "badSelect",
          effect: "roll",
          pieces: { inventory: "diceTray", select: "nearest" },
        },
      ],
    });
  });

  it("rejects orient effect with non-integer orientation", () => {
    fail({
      effects: [
        {
          id: "badOrient",
          effect: "orient",
          pieces: { inventory: "tiles", select: "top" },
          orientation: 1.5,
        },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// EffectCallSchema and EffectCallsSchema (call-site machinery)
// ---------------------------------------------------------------------------

describe("EffectCallSchema", () => {
  it("accepts an effectRef call", () => {
    const r = EffectCallSchema.safeParse({ effectRef: "shuffleDeck" });
    expect(r.success).toBe(true);
  });

  it("accepts an inline effect body", () => {
    const r = EffectCallSchema.safeParse({
      effect: "shuffle",
      inventory: "drawDeck",
    });
    expect(r.success).toBe(true);
  });

  it("accepts an inline update with { param } value", () => {
    const r = EffectCallSchema.safeParse({
      effect: "update",
      pieces: { inventory: "currentBid", select: "top" },
      property: "quantity",
      value: { param: "quantity" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects an object with neither effectRef nor effect", () => {
    const r = EffectCallSchema.safeParse({ id: "something" });
    expect(r.success).toBe(false);
  });

  it("rejects the old ref/kind keys", () => {
    expect(EffectCallSchema.safeParse({ ref: "shuffleDeck" }).success).toBe(false);
    expect(EffectCallSchema.safeParse({ kind: "shuffle", inventory: "deck" }).success).toBe(false);
  });

  it("rejects an entry with both effectRef and effect", () => {
    const r = EffectCallSchema.safeParse({ effectRef: "x", effect: "shuffle", inventory: "deck" });
    expect(r.success).toBe(false);
  });
});

describe("EffectCallsSchema", () => {
  it("accepts a mixed list of refs and inline effects", () => {
    const r = EffectCallsSchema.safeParse([
      { effectRef: "shuffleDeck" },
      { effect: "roll", pieces: { inventory: "diceTray", select: "all" } },
      { effectRef: "dealDice" },
    ]);
    expect(r.success).toBe(true);
  });

  it("rejects an empty list", () => {
    const r = EffectCallsSchema.safeParse([]);
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EffectCallRefSchema
// ---------------------------------------------------------------------------

describe("EffectCallRefSchema", () => {
  it("accepts a valid effectRef", () => {
    const r = EffectCallRefSchema.safeParse({ effectRef: "drawCard" });
    expect(r.success).toBe(true);
  });

  it("rejects missing effectRef field", () => {
    const r = EffectCallRefSchema.safeParse({ name: "drawCard" });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LlmInputSchema / LlmEffectSchema inputs
// ---------------------------------------------------------------------------

describe("LlmInputSchema", () => {
  it("accepts a state source", () => {
    const r = LlmInputSchema.safeParse({
      name: "roundWinner",
      state: "game.property.roundWinner",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a pieces source with a properties whitelist", () => {
    const r = LlmInputSchema.safeParse({
      name: "arenaWeapons",
      pieces: { inventory: "arena", select: "all" },
      properties: ["description"],
    });
    expect(r.success).toBe(true);
  });

  it("accepts a param source", () => {
    const r = LlmInputSchema.safeParse({ name: "wager", param: "wagerAmount" });
    expect(r.success).toBe(true);
  });

  it("rejects more than one source", () => {
    const r = LlmInputSchema.safeParse({
      name: "x",
      state: "game.property.x",
      param: "x",
    });
    expect(r.success).toBe(false);
  });

  it("rejects no source", () => {
    const r = LlmInputSchema.safeParse({ name: "x" });
    expect(r.success).toBe(false);
  });
});

describe("LlmEffectSchema", () => {
  const base = {
    effect: "llm-effect",
    prompt: { computation: "Narrate the clash." },
    outputs: [{ field: "roundNarrative", message: { to: "all" } }],
  };

  it("accepts an effect with declared inputs", () => {
    const r = LlmEffectSchema.safeParse({
      ...base,
      inputs: [
        { name: "roundWinner", state: "game.property.roundWinner" },
        {
          name: "arenaWeapons",
          pieces: { inventory: "arena", select: "all" },
          properties: ["description"],
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("accepts an effect with no inputs (pure ceremony)", () => {
    const r = LlmEffectSchema.safeParse(base);
    expect(r.success).toBe(true);
  });

  it("rejects an input with no source", () => {
    const r = LlmEffectSchema.safeParse({
      ...base,
      inputs: [{ name: "bad" }],
    });
    expect(r.success).toBe(false);
  });
});

describe("PropertyValueSchema — var references", () => {
  it("accepts a game property var reference", () => {
    const r = EffectSchema.safeParse({
      effect: "update",
      pieces: { inventory: "test", select: "top" },
      property: "hp",
      value: { var: "game.property.baseDamage" },
    });
    expect(r.success).toBe(true);
  });

  it("accepts a player property var reference", () => {
    const r = EffectSchema.safeParse({
      effect: "update",
      pieces: { inventory: "test", select: "top" },
      property: "bonusValue",
      value: { var: "player.property.relicCount" },
    });
    expect(r.success).toBe(true);
  });

  it("accepts delta with a literal number", () => {
    const r = EffectSchema.safeParse({
      effect: "update",
      pieces: { inventory: "test", select: "top" },
      property: "score",
      value: { delta: 5 },
    });
    expect(r.success).toBe(true);
  });

  it("accepts delta with a var reference", () => {
    const r = EffectSchema.safeParse({
      effect: "update",
      pieces: { inventory: "test", select: "top" },
      property: "totalDamage",
      value: { delta: { var: "game.property.spellPower" } },
    });
    expect(r.success).toBe(true);
  });

  it("rejects delta with invalid var reference structure", () => {
    const r = EffectSchema.safeParse({
      effect: "update",
      pieces: { inventory: "test", select: "top" },
      property: "score",
      value: { delta: { var: 123 } },
    });
    expect(r.success).toBe(false);
  });

  it("rejects var with non-string path", () => {
    const r = EffectSchema.safeParse({
      effect: "update",
      pieces: { inventory: "test", select: "top" },
      property: "value",
      value: { var: 123 },
    });
    expect(r.success).toBe(false);
  });

  it("accepts delta with var reference and negate: true", () => {
    const r = EffectSchema.safeParse({
      effect: "update",
      pieces: { inventory: "test", select: "top" },
      property: "defense",
      value: { delta: { var: "player.property.damageDealt", negate: true } },
    });
    expect(r.success).toBe(true);
  });

  it("accepts delta with var reference and negate: false", () => {
    const r = EffectSchema.safeParse({
      effect: "update",
      pieces: { inventory: "test", select: "top" },
      property: "score",
      value: { delta: { var: "game.property.bonus", negate: false } },
    });
    expect(r.success).toBe(true);
  });

  it("rejects negate flag on non-var delta", () => {
    const r = EffectSchema.safeParse({
      effect: "update",
      pieces: { inventory: "test", select: "top" },
      property: "score",
      value: { delta: { value: 5, negate: true } },
    });
    expect(r.success).toBe(false);
  });

  it("accepts mult with a literal number", () => {
    const r = EffectSchema.safeParse({
      effect: "update",
      pieces: { inventory: "test", select: "top" },
      property: "damage",
      value: { mult: 0.5 },
    });
    expect(r.success).toBe(true);
  });

  it("accepts mult with a var reference", () => {
    const r = EffectSchema.safeParse({
      effect: "update",
      pieces: { inventory: "test", select: "top" },
      property: "production",
      value: { mult: { var: "player.property.workerCount" } },
    });
    expect(r.success).toBe(true);
  });

  it("accepts mult with var and negate", () => {
    const r = EffectSchema.safeParse({
      effect: "update",
      pieces: { inventory: "test", select: "top" },
      property: "velocity",
      value: { mult: { var: "game.property.friction", negate: true } },
    });
    expect(r.success).toBe(true);
  });

  it("rejects mult with non-number literal", () => {
    const r = EffectSchema.safeParse({
      effect: "update",
      pieces: { inventory: "test", select: "top" },
      property: "score",
      value: { mult: "two" },
    });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Adjust effect
// ---------------------------------------------------------------------------

describe("EffectsModuleSchema — adjust effect", () => {
  it("parses adjust with delta adjustment as named effect", () => {
    const result = ok({
      effects: [{ id: "reduceDamage", effect: "adjust", adjustment: { delta: 2 } }],
    });
    expect(result.effects[0].effect).toBe("adjust");
  });

  it("parses adjust with mult adjustment as named effect", () => {
    const result = ok({
      effects: [{ id: "halveDamage", effect: "adjust", adjustment: { mult: 0.5 } }],
    });
    expect(result.effects[0].effect).toBe("adjust");
  });

  it("parses adjust as inline effect (EffectSchema)", () => {
    const r = EffectSchema.safeParse({
      effect: "adjust",
      adjustment: { delta: -1 },
    });
    expect(r.success).toBe(true);
  });

  it("rejects adjust missing adjustment", () => {
    const r = EffectSchema.safeParse({
      effect: "adjust",
    });
    expect(r.success).toBe(false);
  });

  it("rejects adjust with non-numeric delta", () => {
    const r = EffectSchema.safeParse({
      effect: "adjust",
      adjustment: { delta: "two" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects adjust with non-numeric mult", () => {
    const r = EffectSchema.safeParse({
      effect: "adjust",
      adjustment: { mult: "half" },
    });
    expect(r.success).toBe(false);
  });

  it("accepts adjust delta with var reference", () => {
    const r = EffectSchema.safeParse({
      effect: "adjust",
      adjustment: { delta: { var: "player.property.armorRating" } },
    });
    expect(r.success).toBe(true);
  });

  it("accepts adjust delta with var and negate", () => {
    const r = EffectSchema.safeParse({
      effect: "adjust",
      adjustment: { delta: { var: "player.property.curseStacks", negate: true } },
    });
    expect(r.success).toBe(true);
  });

  it("accepts adjust mult with var reference", () => {
    const r = EffectSchema.safeParse({
      effect: "adjust",
      adjustment: { mult: { var: "player.property.damageMultiplier" } },
    });
    expect(r.success).toBe(true);
  });

  it("accepts adjust mult with var and negate", () => {
    const r = EffectSchema.safeParse({
      effect: "adjust",
      adjustment: { mult: { var: "game.property.debuffFactor", negate: true } },
    });
    expect(r.success).toBe(true);
  });
});
