/**
 * Parse tests for mechanic schemas.
 *
 * Exercises:
 *   - ChargesMechanicSchema (piece-level)
 *   - ConversionMechanicSchema (piece-level)
 *   - ScoreTrackMechanicSchema (game-level)
 *   - DominantGamepieceMechanicSchema (game-level)
 *   - PieceMechanicSchema union
 *   - GameMechanicSchema union
 */

import {
  ChargesMechanicSchema,
  ConversionMechanicSchema,
  ScoreTrackMechanicSchema,
  DominantGamepieceMechanicSchema,
  PieceMechanicSchema,
  GameMechanicSchema,
} from "#gamedef/mechanics/index.js";

function okCharges(data: unknown) {
  const r = ChargesMechanicSchema.safeParse(data);
  if (!r.success) throw new Error(JSON.stringify(r.error.format(), null, 2));
  return r.data;
}
function okConversion(data: unknown) {
  const r = ConversionMechanicSchema.safeParse(data);
  if (!r.success) throw new Error(JSON.stringify(r.error.format(), null, 2));
  return r.data;
}
function okScoreTrack(data: unknown) {
  const r = ScoreTrackMechanicSchema.safeParse(data);
  if (!r.success) throw new Error(JSON.stringify(r.error.format(), null, 2));
  return r.data;
}
function okDominantGamepiece(data: unknown) {
  const r = DominantGamepieceMechanicSchema.safeParse(data);
  if (!r.success) throw new Error(JSON.stringify(r.error.format(), null, 2));
  return r.data;
}
function fail(schema: { safeParse: (d: unknown) => { success: boolean } }, data: unknown) {
  expect(schema.safeParse(data).success).toBe(false);
}

// ---------------------------------------------------------------------------
// ChargesMechanicSchema
// ---------------------------------------------------------------------------

describe("ChargesMechanicSchema", () => {
  const base = {
    kind: "chaincraft:charges",
    slotId: "mygame:energy-ability",
    chargeType: "energyCounter",
    maxCharges: 3,
    count: 2,
    action: "convertOreToGold",
  };

  it("parses minimal valid charges mechanic", () => {
    const r = okCharges(base);
    expect(r.kind).toBe("chaincraft:charges");
    expect(r.slotId).toBe("mygame:energy-ability");
    expect(r.chargeType).toBe("energyCounter");
    expect(r.maxCharges).toBe(3);
    expect(r.count).toBe(2);
    expect(r.action).toBe("convertOreToGold");
  });

  it("defaults depleteTo to game:unassigned", () => {
    const r = okCharges(base);
    expect(r.depleteTo).toBe("game:unassigned");
  });

  it("accepts explicit depleteTo inventory", () => {
    const r = okCharges({ ...base, depleteTo: "chargeDiscard" });
    expect(r.depleteTo).toBe("chargeDiscard");
  });

  it("accepts optional label", () => {
    const r = okCharges({ ...base, label: "Energy Ability" });
    expect(r.label).toBe("Energy Ability");
  });

  it("accepts availableInSubflows", () => {
    const r = okCharges({ ...base, availableInSubflows: ["actionPhase"] });
    expect(r.availableInSubflows).toEqual(["actionPhase"]);
  });

  it("rejects non-namespaced slotId", () => {
    fail(ChargesMechanicSchema, { ...base, slotId: "noNamespace" });
  });

  it("rejects count < 1", () => {
    fail(ChargesMechanicSchema, { ...base, count: 0 });
  });

  it("rejects maxCharges < 1", () => {
    fail(ChargesMechanicSchema, { ...base, maxCharges: 0 });
  });

  it("rejects missing action", () => {
    const { action: _, ...noAction } = base;
    fail(ChargesMechanicSchema, noAction);
  });
});

// ---------------------------------------------------------------------------
// ConversionMechanicSchema
// ---------------------------------------------------------------------------

describe("ConversionMechanicSchema", () => {
  const base = {
    kind: "chaincraft:conversion",
    slotId: "mygame:smelt",
    sources: [{ inventory: "oreStorage", count: 2 }],
    targets: [{ inventory: "ingotStorage", count: 1 }],
  };

  it("parses minimal valid conversion mechanic", () => {
    const r = okConversion(base);
    expect(r.kind).toBe("chaincraft:conversion");
    expect(r.slotId).toBe("mygame:smelt");
    expect(r.sources).toHaveLength(1);
    expect(r.targets).toHaveLength(1);
  });

  it("parses many-to-many conversion", () => {
    const r = okConversion({
      kind: "chaincraft:conversion",
      slotId: "mygame:alchemise",
      sources: [
        { inventory: "fireEssence", count: 1 },
        { inventory: "waterEssence", count: 1 },
      ],
      targets: [
        { inventory: "steamTokens", count: 1 },
        { inventory: "residue", count: 1 },
      ],
    });
    expect(r.sources).toHaveLength(2);
    expect(r.targets).toHaveLength(2);
  });

  it("accepts optional label", () => {
    const r = okConversion({ ...base, label: "Smelt Ore" });
    expect(r.label).toBe("Smelt Ore");
  });

  it("accepts availableInSubflows", () => {
    const r = okConversion({ ...base, availableInSubflows: ["actionPhase"] });
    expect(r.availableInSubflows).toEqual(["actionPhase"]);
  });

  it("rejects non-namespaced slotId", () => {
    fail(ConversionMechanicSchema, { ...base, slotId: "noNamespace" });
  });

  it("rejects empty sources array", () => {
    fail(ConversionMechanicSchema, { ...base, sources: [] });
  });

  it("rejects empty targets array", () => {
    fail(ConversionMechanicSchema, { ...base, targets: [] });
  });

  it("rejects leg with count < 1", () => {
    fail(ConversionMechanicSchema, {
      ...base,
      sources: [{ inventory: "oreStorage", count: 0 }],
    });
  });
});

// ---------------------------------------------------------------------------
// ScoreTrackMechanicSchema
// ---------------------------------------------------------------------------

describe("ScoreTrackMechanicSchema", () => {
  const base = {
    kind: "chaincraft:score-track",
    trackLength: 10,
    scoringProperty: "score",
    scope: "player",
  };

  it("parses minimal valid score track", () => {
    const r = okScoreTrack(base);
    expect(r.kind).toBe("chaincraft:score-track");
    expect(r.trackLength).toBe(10);
    expect(r.scoringProperty).toBe("score");
    expect(r.scope).toBe("player");
  });

  it("accepts optional id for multi-track games", () => {
    const r = okScoreTrack({ ...base, id: "mainScore" });
    expect(r.id).toBe("mainScore");
  });

  it("accepts team scope", () => {
    const r = okScoreTrack({ ...base, scope: "team" });
    expect(r.scope).toBe("team");
  });

  it("accepts winAt with finalRound", () => {
    const r = okScoreTrack({ ...base, winAt: 10, finalRound: true });
    expect(r.winAt).toBe(10);
    expect(r.finalRound).toBe(true);
  });

  it("winAt omitted by default", () => {
    const r = okScoreTrack(base);
    expect(r.winAt).toBeUndefined();
  });

  it("rejects trackLength < 2", () => {
    fail(ScoreTrackMechanicSchema, { ...base, trackLength: 1 });
  });

  it("rejects invalid scope", () => {
    fail(ScoreTrackMechanicSchema, { ...base, scope: "game" });
  });
});

// ---------------------------------------------------------------------------
// DominantGamepieceMechanicSchema
// ---------------------------------------------------------------------------

describe("DominantGamepieceMechanicSchema", () => {
  const base = {
    kind: "chaincraft:dominant-gamepiece",
    evaluationInventory: "arena",
    winnerToState: "game.property.roundWinner",
    rules: [
      {
        kind: "matrix",
        property: "rps",
        beats: { rock: ["scissors"], paper: ["rock"], scissors: ["paper"] },
      },
    ],
  };

  it("parses minimal matrix (RPS) dominant-gamepiece mechanic", () => {
    const r = okDominantGamepiece(base);
    expect(r.kind).toBe("chaincraft:dominant-gamepiece");
    expect(r.evaluationInventory).toBe("arena");
    expect(r.winnerToState).toBe("game.property.roundWinner");
    expect(r.rules).toHaveLength(1);
  });

  it("accepts a chained dominant + comparison rule set (trick-taking)", () => {
    const r = okDominantGamepiece({
      ...base,
      rules: [
        { kind: "dominant", property: "suit", dominantValue: "spades" },
        {
          kind: "comparison",
          property: "rank",
          order: [2, 3, 4, 5, 6, 7, 8, 9, 10, "J", "Q", "K", "A"],
          direction: "highest",
        },
      ],
    });
    expect(r.rules).toHaveLength(2);
  });

  it("accepts a dynamic dominant value via state path", () => {
    const r = okDominantGamepiece({
      ...base,
      rules: [
        { kind: "dominant", property: "suit", dominantValue: "game.property.declaredDominant" },
      ],
    });
    expect(r.rules[0]).toEqual({
      kind: "dominant",
      property: "suit",
      dominantValue: "game.property.declaredDominant",
    });
  });

  it("accepts winningPieceToState alongside winnerToState", () => {
    const r = okDominantGamepiece({ ...base, winningPieceToState: "game.property.winningWeapon" });
    expect(r.winningPieceToState).toBe("game.property.winningWeapon");
  });

  it("accepts winningPieceToState without winnerToState", () => {
    const { winnerToState: _w, ...noWinner } = base;
    const r = okDominantGamepiece({ ...noWinner, winningPieceToState: "game.property.winningWeapon" });
    expect(r.winnerToState).toBeUndefined();
    expect(r.winningPieceToState).toBe("game.property.winningWeapon");
  });

  it("defaults comparison direction to highest", () => {
    const r = okDominantGamepiece({
      ...base,
      rules: [{ kind: "comparison", property: "power" }],
    });
    expect(r.rules[0]).toMatchObject({ direction: "highest" });
  });

  it("rejects an empty rules list", () => {
    fail(DominantGamepieceMechanicSchema, { ...base, rules: [] });
  });

  it("allows omitting winnerToState at the schema level (validator enforces at-least-one)", () => {
    const { winnerToState: _w, ...noWinner } = base;
    const r = okDominantGamepiece({ ...noWinner, winningPieceToState: "game.property.winningWeapon" });
    expect(r.winnerToState).toBeUndefined();
  });

  it("rejects missing evaluationInventory", () => {
    const { evaluationInventory: _, ...noInv } = base;
    fail(DominantGamepieceMechanicSchema, noInv);
  });
});

// ---------------------------------------------------------------------------
// PieceMechanicSchema union
// ---------------------------------------------------------------------------

describe("PieceMechanicSchema (union)", () => {
  it("dispatches chaincraft:charges", () => {
    const r = PieceMechanicSchema.parse({
      kind: "chaincraft:charges",
      slotId: "mygame:tap",
      chargeType: "readinessToken",
      maxCharges: 1,
      count: 1,
      action: "dealDamage",
    });
    expect(r.kind).toBe("chaincraft:charges");
  });

  it("dispatches chaincraft:conversion", () => {
    const r = PieceMechanicSchema.parse({
      kind: "chaincraft:conversion",
      slotId: "mygame:craft",
      sources: [{ inventory: "wood", count: 2 }],
      targets: [{ inventory: "plank", count: 1 }],
    });
    expect(r.kind).toBe("chaincraft:conversion");
  });

  it("rejects unknown kind", () => {
    expect(PieceMechanicSchema.safeParse({ kind: "custom:unknown" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GameMechanicSchema union
// ---------------------------------------------------------------------------

describe("GameMechanicSchema (union)", () => {
  it("dispatches chaincraft:score-track", () => {
    const r = GameMechanicSchema.parse({
      kind: "chaincraft:score-track",
      trackLength: 15,
      scoringProperty: "vp",
      scope: "player",
      winAt: 10,
      finalRound: true,
    });
    expect(r.kind).toBe("chaincraft:score-track");
  });

  it("dispatches chaincraft:dominant-gamepiece", () => {
    const r = GameMechanicSchema.parse({
      kind: "chaincraft:dominant-gamepiece",
      evaluationInventory: "arena",
      winnerToState: "game.property.roundWinner",
      rules: [
        {
          kind: "matrix",
          property: "rps",
          beats: { rock: ["scissors"], paper: ["rock"], scissors: ["paper"] },
        },
      ],
    });
    expect(r.kind).toBe("chaincraft:dominant-gamepiece");
  });

  it("rejects unknown kind", () => {
    expect(GameMechanicSchema.safeParse({ kind: "chaincraft:auction" }).success).toBe(false);
  });
});
