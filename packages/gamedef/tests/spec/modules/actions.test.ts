/**
 * Parse tests for ActionsModuleSchema.
 *
 * "Liar's Dice" — bluffing dice game.
 * Exercises every feature of the actions module:
 *   - ActionInputSchema: integer, float, string, boolean, enum, effect-originator types
 *   - ActionInput.validation (prose constraint)
 *   - ActionSchema: id, label, description, oncePerTurn, requiredRole
 *   - ActionSchema: availableInSubflows, preconditions (infix expression)
 *   - ActionSchema: input steps + { param } resolution convention
 *   - ActionSchema: interrupt (subflow array)
 *   - ActionSchema: reactive { trigger, timing: before | after }
 *   - ActionSchema: steps — input, effectRef, and inline effect steps
 *   - ActionsModuleSchema: min 1 action
 */

import { ActionsModuleSchema } from "#gamedef/modules/actions.js";
import type { ActionInput, ActionStep } from "#gamedef/modules/actions.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inputSteps(steps: ActionStep[]): ActionInput[] {
  return steps.filter((s): s is ActionInput => "input" in s);
}

function ok(data: unknown) {
  const result = ActionsModuleSchema.safeParse(data);
  if (!result.success) throw new Error(JSON.stringify(result.error.format(), null, 2));
  return result.data;
}

function fail(data: unknown) {
  const result = ActionsModuleSchema.safeParse(data);
  expect(result.success).toBe(false);
}

// ---------------------------------------------------------------------------
// Valid: full Liar's Dice actions module
// ---------------------------------------------------------------------------

describe("ActionsModuleSchema — Liar's Dice", () => {
  const validModule = {
    actions: [
      // Core bid action — exercises inputs, { param } convention, inline effects
      {
        id: "makeBid",
        label: "Make Bid",
        description: "Declare a quantity and face value for the current bid",
        steps: [
          {
            input: "quantity",
            type: { kind: "number", min: 1, max: 30 },
            label: "Quantity",
            validation: "Must be strictly higher than the current bid quantity unless face-value also increases",
          },
          {
            input: "faceValue",
            type: { kind: "number", min: 1, max: 6 },
            label: "Face Value",
          },
          {
            effect: "update",
            pieces: { inventory: "currentBid", select: "top" },
            property: "quantity",
            value: { param: "quantity" },
          },
          {
            effect: "update",
            pieces: { inventory: "currentBid", select: "top" },
            property: "faceValue",
            value: { param: "faceValue" },
          },
        ],
      },

      // Challenge action — preconditions (infix expression), named-effect ref
      {
        id: "challenge",
        label: "Challenge",
        description: "Call out the current bid as a lie",
        preconditions: "count(game.inventory.currentBid) != 0",
        steps: [{ effectRef: "resolveChallenge" }],
      },

      // Pass action — simple, no inputs
      {
        id: "pass",
        label: "Pass",
        steps: [{ effectRef: "advanceTurn" }],
      },

      // Roll dice — once per turn
      {
        id: "rollDice",
        label: "Roll Dice",
        oncePerTurn: true,
        steps: [
          { effect: "roll", pieces: { inventory: "playerTray", select: "all" } },
        ],
      },

      // Role-gated action — requiredRoles
      {
        id: "peekBid",
        label: "Peek at Bid",
        requiredRoles: ["spy"],
        steps: [
          {
            effect: "flip",
            pieces: { inventory: "currentBid", select: "top" },
            to: "face-up",
          },
        ],
      },

      // Subflow-scoped action — availableInSubflows
      {
        id: "exchangeDie",
        label: "Exchange Die",
        availableInSubflows: ["tradePhase"],
        steps: [
          {
            input: "dieToExchange",
            type: { kind: "gamepiece-select", inventory: "playerTray", count: 1 },
          },
          {
            effect: "move",
            from: { inventory: "playerTray", select: { id: { param: "dieToExchange" } } },
            to: { inventory: "exchangePool" },
          },
        ],
      },

      // Compound precondition — boolean AND
      {
        id: "buySpecialDie",
        label: "Buy Special Die",
        preconditions: "actor.property.coins >= 3 and count(game.inventory.specialDice) != 0",
        steps: [
          { effectRef: "purchaseSpecialDie" },
        ],
      },

      // Interrupt action — eligible during response-window subflow
      {
        id: "blockSteal",
        label: "Block Steal",
        interrupt: ["responseWindow"],
        steps: [{ effect: "cancel-effect" }],
      },

      // Reactive negate — before timing (cancel the triggering effect)
      {
        id: "deflectAttack",
        label: "Deflect",
        interrupt: ["combatResponse"],
        reactive: {
          trigger: "dealDamage",
          timing: "before",
        },
        steps: [
          {
            input: "attacker",
            type: { kind: "effect-originator" },
            label: "Attacker",
          },
          { effect: "cancel-effect" },
        ],
      },

      // Reactive reaction — after timing (adjust the effect)
      {
        id: "resilience",
        label: "Resilience",
        reactive: {
          trigger: "takeDamage",
          timing: "after",
        },
        steps: [{ effectRef: "healOneHp" }],
      },

      // Mixed effects list — ref + inline
      {
        id: "powerMove",
        label: "Power Move",
        steps: [
          { effectRef: "shuffleCup" },
          { effect: "roll", pieces: { inventory: "playerTray", select: "all" } },
          { effectRef: "resolveChallenge" },
        ],
      },

      // All input types exercised
      {
        id: "configureGame",
        label: "Configure",
        steps: [
          { input: "rounds", type: { kind: "number", min: 1, max: 10 } },
          { input: "speed", type: { kind: "number", min: 0.5, max: 2.0, integer: false } },
          { input: "name", type: { kind: "string" } },
          { input: "hardcore", type: { kind: "boolean" } },
          { input: "variant", type: { kind: "enum", values: ["classic", "speed", "team"] } },
          { effectRef: "applyConfig" },
        ],
      },
    ],
  };

  it("parses a valid full module without errors", () => {
    const result = ok(validModule);
    expect(result.actions).toHaveLength(12);
  });

  it("preserves action ids", () => {
    const result = ok(validModule);
    const ids = result.actions.map((a) => a.id);
    expect(ids).toContain("makeBid");
    expect(ids).toContain("challenge");
    expect(ids).toContain("deflectAttack");
  });

  it("preserves input steps on make-bid", () => {
    const result = ok(validModule);
    const bid = result.actions.find((a) => a.id === "makeBid")!;
    const inputs = inputSteps(bid.steps);
    expect(inputs).toHaveLength(2);
    expect(inputs[0].input).toBe("quantity");
    expect(inputs[0].type.kind).toBe("number");
  });

  it("preserves { param } in inline effects", () => {
    const result = ok(validModule);
    const bid = result.actions.find((a) => a.id === "makeBid")!;
    const firstEffect = bid.steps[2] as { effect: string; value: unknown };
    expect(firstEffect.effect).toBe("update");
    expect(firstEffect.value).toEqual({ param: "quantity" });
  });

  it("preserves preconditions as infix expression string", () => {
    const result = ok(validModule);
    const challenge = result.actions.find((a) => a.id === "challenge")!;
    expect(challenge.preconditions).toBe("count(game.inventory.currentBid) != 0");
  });

  it("preserves reactive fields", () => {
    const result = ok(validModule);
    const deflect = result.actions.find((a) => a.id === "deflectAttack")!;
    expect(deflect.reactive?.trigger).toBe("dealDamage");
    expect(deflect.reactive?.timing).toBe("before");
  });

  it("preserves reactive after timing", () => {
    const result = ok(validModule);
    const resilience = result.actions.find((a) => a.id === "resilience")!;
    expect(resilience.reactive?.timing).toBe("after");
  });

  it("preserves interrupt subflow list", () => {
    const result = ok(validModule);
    const block = result.actions.find((a) => a.id === "blockSteal")!;
    expect(block.interrupt).toEqual(["responseWindow"]);
  });

  it("preserves effect-originator input type", () => {
    const result = ok(validModule);
    const deflect = result.actions.find((a) => a.id === "deflectAttack")!;
    const attackerInput = inputSteps(deflect.steps).find((i) => i.input === "attacker")!;
    expect(attackerInput.type.kind).toBe("effect-originator");
  });

  it("preserves oncePerTurn flag", () => {
    const result = ok(validModule);
    const roll = result.actions.find((a) => a.id === "rollDice")!;
    expect(roll.oncePerTurn).toBe(true);
  });

  it("preserves requiredRoles", () => {
    const result = ok(validModule);
    const peek = result.actions.find((a) => a.id === "peekBid")!;
    expect(peek.requiredRoles).toEqual(["spy"]);
  });

  it("accepts action with no inputs", () => {
    const result = ok({ actions: [{ id: "pass", steps: [{ effectRef: "advanceTurn" }] }] });
    expect(inputSteps(result.actions[0].steps)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Rejections
// ---------------------------------------------------------------------------

describe("ActionsModuleSchema — rejections", () => {
  it("rejects an empty actions array", () => {
    fail({ actions: [] });
  });

  it("rejects action missing required id", () => {
    fail({
      actions: [{ label: "Unnamed", steps: [{ effectRef: "something" }] }],
    });
  });

  it("rejects action missing required steps", () => {
    fail({
      actions: [{ id: "noEffects" }],
    });
  });

  it("rejects action with empty steps array", () => {
    fail({
      actions: [{ id: "emptyEffects", steps: [] }],
    });
  });

  it("rejects action with only input steps", () => {
    fail({
      actions: [{ id: "inputsOnly", steps: [{ input: "x", type: { kind: "boolean" } }] }],
    });
  });

  it("rejects the old inputs/effects shape", () => {
    fail({
      actions: [{ id: "old", effects: [{ ref: "something" }] }],
    });
  });

  it("rejects a step with more than one of input/effect/effectRef", () => {
    const result = ActionsModuleSchema.safeParse({
      actions: [{ id: "both", steps: [{ effectRef: "a", effect: "shuffle", inventory: "deck" }] }],
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].path).toEqual(["actions", 0, "steps", 0]);
    expect(result.error!.issues[0].message).toMatch(/found effect, effectRef/);
  });

  it("reports errors from the chosen step kind only", () => {
    const result = ActionsModuleSchema.safeParse({
      actions: [{ id: "bad", steps: [{ effect: "move", to: { inventory: "hand" } }] }],
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.path)).toEqual([["actions", 0, "steps", 0, "from"]]);
  });

  it("rejects input with unknown type kind", () => {
    fail({
      actions: [
        {
          id: "badInput",
          steps: [{ input: "x", type: { kind: "date" } }, { effectRef: "something" }],
        },
      ],
    });
  });

  it("rejects enum input with fewer than 2 values", () => {
    fail({
      actions: [
        {
          id: "badEnum",
          steps: [
            { input: "choice", type: { kind: "enum", values: ["only-one"] } },
            { effectRef: "something" },
          ],
        },
      ],
    });
  });

  it("rejects interrupt with empty array", () => {
    fail({
      actions: [
        {
          id: "badInterrupt",
          interrupt: [],
          steps: [{ effectRef: "something" }],
        },
      ],
    });
  });

  it("rejects reactive with invalid timing", () => {
    fail({
      actions: [
        {
          id: "badReactive",
          reactive: { trigger: "someEffect", timing: "during" },
          steps: [{ effectRef: "something" }],
        },
      ],
    });
  });

  it("rejects reactive missing trigger", () => {
    fail({
      actions: [
        {
          id: "badReactive",
          reactive: { timing: "before" },
          steps: [{ effectRef: "something" }],
        },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// Action input kinds: gamepiece-select, player-select, inventory-position
// ---------------------------------------------------------------------------

describe("ActionsModuleSchema — selection inputs", () => {
  it("accepts gamepiece-select input", () => {
    ok({
      actions: [
        {
          id: "discard",
          steps: [
            {
              input: "card",
              type: { kind: "gamepiece-select", inventory: "playerHand" },
              label: "Choose card",
            },
            {
              effect: "move",
              from: { inventory: "playerHand", select: { id: { param: "card" } } },
              to: { inventory: "discardPile" },
            },
          ],
        },
      ],
    });
  });

  it("accepts gamepiece-select with ofType and count", () => {
    ok({
      actions: [
        {
          id: "draft",
          steps: [
            {
              input: "picks",
              type: { kind: "gamepiece-select", inventory: "draftHand", ofType: "card", count: 2 },
              label: "Choose 2 cards",
            },
            { effectRef: "addToHand" },
          ],
        },
      ],
    });
  });

  it("accepts gamepiece-select with fromPlayer referencing prior input", () => {
    ok({
      actions: [
        {
          id: "steal",
          steps: [
            {
              input: "target",
              type: { kind: "player-select", excludeSelf: true },
              label: "Choose opponent",
            },
            {
              input: "card",
              type: { kind: "gamepiece-select", inventory: "playerHand", fromPlayer: { param: "target" } },
              label: "Choose card to steal",
            },
            {
              effect: "move",
              from: { player: { param: "target" }, inventory: "playerHand", select: { id: { param: "card" } } },
              to: { inventory: "playerHand" },
            },
          ],
        },
      ],
    });
  });

  it("accepts gamepiece-select with fromPlayer 'self'", () => {
    ok({
      actions: [
        {
          id: "playCard",
          steps: [
            {
              input: "card",
              type: { kind: "gamepiece-select", inventory: "playerHand", fromPlayer: "self" },
            },
            { effectRef: "play" },
          ],
        },
      ],
    });
  });

  it("accepts gamepiece-select with expression filter", () => {
    ok({
      actions: [
        {
          id: "selectCreature",
          steps: [
            {
              input: "creature",
              type: {
                kind: "gamepiece-select",
                inventory: "battlefield",
                filter: "piece.property.hp >= 1",
              },
            },
            { effectRef: "attack" },
          ],
        },
      ],
    });
  });

  it("accepts player-select input", () => {
    ok({
      actions: [
        {
          id: "targetPlayer",
          steps: [
            {
              input: "opponent",
              type: { kind: "player-select", excludeSelf: true },
              label: "Choose opponent",
            },
            { effectRef: "attackPlayer" },
          ],
        },
      ],
    });
  });

  it("accepts player-select with expression filter", () => {
    ok({
      actions: [
        {
          id: "healAlly",
          steps: [
            {
              input: "ally",
              type: {
                kind: "player-select",
                filter: "player.property.hp < player.property.maxHp",
              },
            },
            { effectRef: "heal" },
          ],
        },
      ],
    });
  });

  it("accepts inventory-position input", () => {
    ok({
      actions: [
        {
          id: "deploy",
          steps: [
            {
              input: "unit",
              type: { kind: "gamepiece-select", inventory: "reserves" },
            },
            {
              input: "cell",
              type: { kind: "inventory-position", inventory: "battleGrid" },
              label: "Choose position",
            },
            {
              effect: "move",
              from: { inventory: "reserves", select: { id: { param: "unit" } } },
              to: { inventory: "battleGrid", at: { param: "cell" } },
            },
          ],
        },
      ],
    });
  });

  it("accepts inventory-position with fromPlayer", () => {
    ok({
      actions: [
        {
          id: "sabotage",
          steps: [
            {
              input: "target",
              type: { kind: "player-select", excludeSelf: true },
            },
            {
              input: "slot",
              type: { kind: "inventory-position", inventory: "board", fromPlayer: { param: "target" } },
            },
            { effectRef: "destroyAt" },
          ],
        },
      ],
    });
  });

  it("rejects gamepiece-select missing inventory", () => {
    fail({
      actions: [
        {
          id: "bad",
          steps: [
            { input: "card", type: { kind: "gamepiece-select" } },
            { effectRef: "x" },
          ],
        },
      ],
    });
  });

  it("rejects inventory-position missing inventory", () => {
    fail({
      actions: [
        {
          id: "bad",
          steps: [
            { input: "cell", type: { kind: "inventory-position" } },
            { effectRef: "x" },
          ],
        },
      ],
    });
  });

  it("accepts param-ref in GamepieceSelector.select", () => {
    ok({
      actions: [
        {
          id: "updateChosen",
          steps: [
            { input: "piece", type: { kind: "gamepiece-select", inventory: "board" } },
            {
              effect: "update",
              pieces: { inventory: "board", select: { id: { param: "piece" } } },
              property: "activated",
              value: true,
            },
          ],
        },
      ],
    });
  });

  it("accepts param-ref in InventoryTarget.player", () => {
    ok({
      actions: [
        {
          id: "gift",
          steps: [
            { input: "recipient", type: { kind: "player-select", excludeSelf: true } },
            {
              effect: "move",
              from: { inventory: "playerHand", select: "top" },
              to: { player: { param: "recipient" }, inventory: "playerHand" },
            },
          ],
        },
      ],
    });
  });

  it("accepts stateRef in InventoryTarget.player", () => {
    ok({
      actions: [
        {
          id: "punish",
          steps: [
            {
              effect: "move",
              from: { inventory: "penaltyPool", select: "top" },
              to: { player: { stateRef: "game.property.roundLoser" }, inventory: "playerHand" },
            },
          ],
        },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// Reactive action inputs (effect-originator and trigger-input)
// ---------------------------------------------------------------------------

describe("ActionsModuleSchema — reactive input types", () => {
  it("accepts effect-originator input type", () => {
    const result = ok({
      actions: [
        {
          id: "counterAttack",
          reactive: { trigger: "dealDamage", timing: "after" },
          steps: [
            { input: "attacker", type: { kind: "effect-originator" } },
            {
              effect: "set-state",
              path: "player.property.hp",
              value: { delta: -2 },
              target: { kind: "param", inputId: "attacker" },
            },
          ],
        },
      ],
    });
    expect(inputSteps(result.actions[0].steps)[0].type.kind).toBe("effect-originator");
  });

  it("accepts trigger-input input type", () => {
    const result = ok({
      actions: [
        {
          id: "thorns",
          reactive: { trigger: "dealDamage", timing: "after" },
          steps: [
            { input: "attackingCreature", type: { kind: "trigger-input", inputId: "creature" } },
            {
              effect: "update",
              pieces: { inventory: "battlefield", select: { id: { param: "attackingCreature" } } },
              property: "hp",
              value: { delta: -2 },
            },
          ],
        },
      ],
    });
    const [attackingCreature] = inputSteps(result.actions[0].steps);
    expect(attackingCreature.type.kind).toBe("trigger-input");
    expect((attackingCreature.type as any).inputId).toBe("creature");
  });

  it("rejects trigger-input missing inputId", () => {
    fail({
      actions: [
        {
          id: "badTrigger",
          reactive: { trigger: "dealDamage", timing: "after" },
          steps: [
            { input: "x", type: { kind: "trigger-input" } },
            { effectRef: "someEffect" },
          ],
        },
      ],
    });
  });

  it("accepts adjust effect in reactive action", () => {
    const result = ok({
      actions: [
        {
          id: "brace",
          reactive: { trigger: "dealDamage", timing: "before" },
          steps: [
            { effect: "adjust", adjustment: { delta: 2 } },
          ],
        },
      ],
    });
    expect(result.actions[0].steps.length).toBe(1);
  });

  it("accepts cancel-effect in reactive action", () => {
    const result = ok({
      actions: [
        {
          id: "block",
          reactive: { trigger: "dealDamage", timing: "before" },
          steps: [
            { effect: "cancel-effect" },
          ],
        },
      ],
    });
    expect(result.actions[0].steps.length).toBe(1);
  });

  it("accepts adjust with mult in reactive action", () => {
    const result = ok({
      actions: [
        {
          id: "shieldBlock",
          reactive: { trigger: "dealDamage", timing: "before" },
          steps: [
            { effect: "adjust", adjustment: { mult: 0.5 } },
          ],
        },
      ],
    });
    expect(result.actions[0].steps.length).toBe(1);
  });
});
