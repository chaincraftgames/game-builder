/**
 * Parse tests for GamepieceTypesModuleSchema.
 *
 * "Pirate Duel" — two-player card-and-dice battle game.
 * Exercises every feature of the gamepiece-types module:
 *   - category: card, token, dice, tile, board
 *   - hasFaceState
 *   - exhaustible
 *   - faceCount (dice)
 *   - orientationCount (tile)
 *   - mutable + immutable properties
 *   - all PropertyType kinds (integer, float, string, boolean, enum)
 *   - PropertyVisibility (always, revealed, owner, never)
 *   - inventorySlots
 *   - actionSlots (with and without availableInSubflows)
 *   - optional label and description fields
 */

import { GamepieceTypesModuleSchema } from "#gamedef/modules/gamepiece-types.js";

// ---------------------------------------------------------------------------
// Valid: full Pirate Duel module
// ---------------------------------------------------------------------------

describe("GamepieceTypesModuleSchema — Pirate Duel", () => {
  const validModule = {
    types: [
      // ---- card: attack/defense cards, face-down until played ----
      {
        id: "combatCard",
        category: "card",
        description: "An attack or defense card played during combat",
        hasFaceState: true,
        exhaustible: true,
        properties: [
          {
            id: "cardType",
            label: "Card Type",
            type: { kind: "enum", values: ["attack", "defense", "special"] },
            mutable: false,
            visibility: "revealed",
          },
          {
            id: "power",
            label: "Power",
            type: { kind: "number", min: 1, max: 10 },
            mutable: false,
            visibility: "revealed",
            description: "Base power value of this card",
          },
          {
            id: "goldCost",
            label: "Gold Cost",
            type: { kind: "number", min: 0 },
            mutable: false,
            visibility: "always",
            description: "Cost in gold to play this card",
          },
          {
            id: "isExhausted",
            type: { kind: "boolean" },
            mutable: true,
            default: false,
            visibility: "always",
            description: "Whether this card has been used this turn",
          },
        ],
        actionSlots: [
          {
            id: "cardAbility",
            description: "Special ability on this card, if any",
            availableInSubflows: ["combatPhase"],
          },
        ],
      },

      // ---- token: gold coins used as currency ----
      {
        id: "goldCoin",
        category: "token",
        description: "A gold coin used to pay card costs",
      },

      // ---- token: damage marker placed on captain ----
      {
        id: "damageMarker",
        category: "token",
        description: "Placed on a captain to track damage taken",
      },

      // ---- token: the player's captain unit ----
      {
        id: "captain",
        category: "token",
        description: "Each player's captain — the piece that must survive",
        properties: [
          {
            id: "hitPoints",
            label: "Hit Points",
            type: { kind: "number", min: 0, max: 20 },
            mutable: true,
            default: 20,
            visibility: "always",
          },
          {
            id: "shipName",
            label: "Ship Name",
            type: { kind: "string" },
            mutable: false,
            visibility: "always",
            description: "Flavor name for this captain's ship",
          },
          {
            id: "combatBonus",
            label: "Combat Bonus",
            type: { kind: "number", min: 0.0, max: 2.0, integer: false },
            mutable: false,
            visibility: "always",
            description: "Multiplier applied to card power during this captain's attacks",
          },
          {
            id: "isStunned",
            type: { kind: "boolean" },
            mutable: true,
            default: false,
            visibility: "always",
          },
          {
            id: "stunCountdown",
            type: { kind: "number", min: 0, max: 3 },
            mutable: true,
            default: 0,
            visibility: "never",
            description: "Engine-tracked rounds remaining in stun; never shown to players",
          },
        ],
        inventorySlots: [
          {
            id: "hand",
            inventoryTypeId: "playerHand",
            description: "Cards currently held by this captain",
          },
          {
            id: "gold",
            inventoryTypeId: "goldPool",
            description: "Gold coins available to spend",
          },
        ],
      },

      // ---- dice: d6 used for combat rolls ----
      {
        id: "combatDie",
        category: "dice",
        description: "Six-sided die rolled to resolve combat ties",
        faceCount: 6,
      },

      // ---- tile: a sea zone tile with 4-way orientation ----
      {
        id: "seaZone",
        category: "tile",
        description: "A sea zone tile placed to build the battle map",
        orientationCount: 4,
        properties: [
          {
            id: "terrain",
            type: { kind: "enum", values: ["open-water", "reef", "fog", "whirlpool"] },
            mutable: false,
            visibility: "revealed",
          },
          {
            id: "isRevealed",
            type: { kind: "boolean" },
            mutable: true,
            default: false,
            visibility: "always",
          },
        ],
        hasFaceState: true,
      },

      // ---- board: the shared play area holding the battle grid ----
      {
        id: "battleMap",
        category: "board",
        description: "The shared play surface where sea zones and captains are placed",
        inventorySlots: [
          {
            id: "zones",
            inventoryTypeId: "seaZoneGrid",
            description: "The grid of sea zone tiles",
          },
          {
            id: "drawPile",
            inventoryTypeId: "combatCardDeck",
            description: "Shared draw pile for combat cards",
          },
        ],
      },
    ],
  };

  it("parses a valid full module without errors", () => {
    expect(() => GamepieceTypesModuleSchema.parse(validModule)).not.toThrow();
  });

  it("applies defaults: hasFaceState=false, exhaustible=false, orientationCount=1", () => {
    const result = GamepieceTypesModuleSchema.parse(validModule);
    const goldCoin = result.types.find((t) => t.id === "goldCoin")!;
    expect(goldCoin.hasFaceState).toBe(false);
    expect(goldCoin.exhaustible).toBe(false);
    expect(goldCoin.orientationCount).toBe(1);
  });

  it("preserves explicit hasFaceState, exhaustible, and orientationCount", () => {
    const result = GamepieceTypesModuleSchema.parse(validModule);
    const card = result.types.find((t) => t.id === "combatCard")!;
    expect(card.hasFaceState).toBe(true);
    expect(card.exhaustible).toBe(true);
    const tile = result.types.find((t) => t.id === "seaZone")!;
    expect(tile.orientationCount).toBe(4);
  });

  it("preserves faceCount on dice", () => {
    const result = GamepieceTypesModuleSchema.parse(validModule);
    const die = result.types.find((t) => t.id === "combatDie")!;
    expect(die.faceCount).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Invalid: schema rejection cases
// ---------------------------------------------------------------------------

describe("GamepieceTypesModuleSchema — rejections", () => {
  it("rejects an empty types array", () => {
    expect(() => GamepieceTypesModuleSchema.parse({ types: [] })).toThrow();
  });

  it("rejects a type missing required 'id'", () => {
    expect(() =>
      GamepieceTypesModuleSchema.parse({
        types: [{ category: "card" }],
      }),
    ).toThrow();
  });

  it("rejects a type with an unknown category", () => {
    expect(() =>
      GamepieceTypesModuleSchema.parse({
        types: [{ id: "thing", category: "spaceship" }],
      }),
    ).toThrow();
  });

  it("rejects a property missing required 'id'", () => {
    expect(() =>
      GamepieceTypesModuleSchema.parse({
        types: [
          {
            id: "card",
            category: "card",
            properties: [
              { type: { kind: "boolean" }, mutable: true, visibility: "always" },
            ],
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects an unknown property type kind", () => {
    expect(() =>
      GamepieceTypesModuleSchema.parse({
        types: [
          {
            id: "card",
            category: "card",
            properties: [
              { id: "x", type: { kind: "set" }, mutable: false, visibility: "always" },
            ],
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects enum with fewer than 2 values", () => {
    expect(() =>
      GamepieceTypesModuleSchema.parse({
        types: [
          {
            id: "card",
            category: "card",
            properties: [
              {
                id: "x",
                type: { kind: "enum", values: ["only-one"] },
                mutable: false,
                visibility: "always",
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });

  it("accepts a player-id property type", () => {
    const r = GamepieceTypesModuleSchema.safeParse({
      types: [
        {
          id: "card",
          category: "card",
          properties: [
            { id: "assignedPlayer", type: { kind: "player-id" }, mutable: true, visibility: "never" },
          ],
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("accepts a player-role-id property type", () => {
    const r = GamepieceTypesModuleSchema.safeParse({
      types: [
        {
          id: "token",
          category: "token",
          properties: [
            { id: "role", type: { kind: "player-role-id" }, mutable: true, visibility: "always" },
          ],
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("accepts a gamepiece-id property type", () => {
    const r = GamepieceTypesModuleSchema.safeParse({
      types: [
        {
          id: "card",
          category: "card",
          properties: [
            { id: "capturedPiece", type: { kind: "gamepiece-id" }, mutable: true, visibility: "never" },
          ],
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects faceCount less than 2", () => {
    expect(() =>
      GamepieceTypesModuleSchema.parse({
        types: [{ id: "die", category: "dice", faceCount: 1 }],
      }),
    ).toThrow();
  });

  it("rejects orientationCount less than 1", () => {
    expect(() =>
      GamepieceTypesModuleSchema.parse({
        types: [{ id: "tile", category: "tile", orientationCount: 0 }],
      }),
    ).toThrow();
  });

  it("rejects an unknown property visibility value", () => {
    expect(() =>
      GamepieceTypesModuleSchema.parse({
        types: [
          {
            id: "card",
            category: "card",
            properties: [
              {
                id: "x",
                type: { kind: "boolean" },
                mutable: false,
                visibility: "public",
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Passive slots on gamepiece types
// ---------------------------------------------------------------------------

describe("GamepieceTypesModuleSchema — passiveSlots", () => {
  it("accepts a piece type with a passive slot", () => {
    const result = GamepieceTypesModuleSchema.parse({
      types: [
        {
          id: "equipment",
          category: "token",
          passiveSlots: [
            {
              id: "wornPassive",
              description: "The passive granted while this equipment is worn",
              enabledIn: ["equipmentSlot"],
            },
          ],
        },
      ],
    });
    expect(result.types[0].passiveSlots![0].id).toBe("wornPassive");
  });

  it("accepts a piece type with multiple passive slots", () => {
    const result = GamepieceTypesModuleSchema.parse({
      types: [
        {
          id: "dualEnchant",
          category: "token",
          passiveSlots: [
            { id: "primaryPassive", enabledIn: ["field"] },
            { id: "secondaryPassive", enabledIn: ["field"] },
          ],
        },
      ],
    });
    expect(result.types[0].passiveSlots).toHaveLength(2);
  });

  it("accepts a piece type with no passiveSlots", () => {
    const result = GamepieceTypesModuleSchema.parse({
      types: [{ id: "plainToken", category: "token" }],
    });
    expect(result.types[0].passiveSlots).toBeUndefined();
  });
});
