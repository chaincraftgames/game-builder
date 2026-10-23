/**
 * ActorContext validator — effects in actor-less flow hooks must name their players.
 */

import { describe, expect, it } from "@jest/globals";
import { validate } from "../../src/validator/index.js";

const META = { name: "Test Game", playerCount: { min: 2, max: 2 } };

const INVENTORIES = {
  types: [
    { id: "hand", scope: { kind: "player" }, accepts: ["card"], visibility: "owner" },
    { id: "deck", scope: { kind: "game" }, accepts: ["card"], visibility: "never" },
  ],
};

const DUMMY_TURN = {
  kind: "turn",
  actor: "all-players",
  grammar: { kind: "action", ref: "dummy" },
};

function specWith(effects: Record<string, unknown>[], hookCalls: Record<string, unknown>[], onVictory?: Record<string, unknown>[]) {
  return {
    metadata: META,
    inventories: INVENTORIES,
    effects: { effects },
    flow: {
      root: {
        kind: "game",
        ...(hookCalls.length > 0 ? { hooks: { onEnter: hookCalls } } : {}),
        ...(onVictory
          ? { winConditions: [{ rule: "condition", condition: "true", onVictory }] }
          : {}),
        children: [{ kind: "loop", count: 1, children: [DUMMY_TURN] }],
      },
    },
  };
}

const actorErrors = (raw: unknown) =>
  validate(raw).errors.filter((e) => e.path.startsWith("flow.root"));

describe("ActorContext — hook selectors", () => {
  it("rejects a player-scoped selector with no player in a hook", () => {
    const errors = actorErrors(
      specWith(
        [{ id: "rollHands", effect: "roll", pieces: { inventory: "hand", select: "all" } }],
        [{ effectRef: "rollHands" }],
      ),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe("flow.root.hooks.onEnter[0]");
    expect(errors[0].message).toContain('"hand"');
    expect(errors[0].message).toContain("player: { kind: all }");
  });

  it("accepts a player-scoped selector with player: all in a hook", () => {
    const errors = actorErrors(
      specWith(
        [{ id: "rollHands", effect: "roll", pieces: { player: { kind: "all" }, inventory: "hand", select: "all" } }],
        [{ effectRef: "rollHands" }],
      ),
    );
    expect(errors).toHaveLength(0);
  });

  it("accepts a game-scoped selector with no player in a hook", () => {
    const errors = actorErrors(
      specWith(
        [{ id: "rollDeck", effect: "roll", pieces: { inventory: "deck", select: "all" } }],
        [{ effectRef: "rollDeck" }],
      ),
    );
    expect(errors).toHaveLength(0);
  });

  it("rejects player kind actor / all-other in a hook", () => {
    for (const kind of ["actor", "all-other"]) {
      const errors = actorErrors(
        specWith(
          [{ id: "rollHands", effect: "roll", pieces: { player: { kind }, inventory: "hand", select: "all" } }],
          [{ effectRef: "rollHands" }],
        ),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain(`"${kind}"`);
    }
  });

  it("checks inline hook effects", () => {
    const errors = actorErrors(
      specWith(
        [{ id: "unused", effect: "roll", pieces: { inventory: "deck", select: "all" } }],
        [{ effect: "hide", pieces: { inventory: "hand", select: "all" } }],
      ),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("Inline effect");
  });

  it("checks onVictory effects", () => {
    const errors = actorErrors(
      specWith(
        [{ id: "hideHands", effect: "hide", pieces: { inventory: "hand", select: "all" } }],
        [],
        [{ effectRef: "hideHands" }],
      ),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe("flow.root.winConditions[0].onVictory[0]");
  });
});

describe("ActorContext — hook move destination and set-state", () => {
  it("rejects a move into a player-scoped inventory with no player", () => {
    const errors = actorErrors(
      specWith(
        [{ id: "deal", effect: "move", from: { inventory: "deck", select: "top" }, to: { inventory: "hand" } }],
        [{ effectRef: "deal" }],
      ),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('"to"');
  });

  it("accepts a move into a player-scoped inventory with an explicit player", () => {
    const errors = actorErrors(
      specWith(
        [
          {
            id: "deal",
            effect: "move",
            from: { inventory: "deck", select: "top" },
            to: { player: { kind: "stateRef", path: "game.property.p" }, inventory: "hand" },
          },
        ],
        [{ effectRef: "deal" }],
      ),
    );
    expect(errors).toHaveLength(0);
  });

  it("rejects a player-property set-state with no target", () => {
    const errors = actorErrors(
      specWith(
        [{ id: "reset", effect: "set-state", path: "player.property.score", value: 0 }],
        [{ effectRef: "reset" }],
      ),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("target");
  });

  it("accepts a player-property set-state with target all", () => {
    const errors = actorErrors(
      specWith(
        [{ id: "reset", effect: "set-state", path: "player.property.score", value: 0, target: { kind: "all" } }],
        [{ effectRef: "reset" }],
      ),
    );
    expect(errors).toHaveLength(0);
  });
});

describe("ActorContext — action steps are not checked", () => {
  it("does not flag the same effect used from an action", () => {
    const raw = {
      metadata: META,
      inventories: INVENTORIES,
      effects: {
        effects: [{ id: "rollHands", effect: "roll", pieces: { inventory: "hand", select: "all" } }],
      },
      actions: {
        actions: [
          { id: "dummy", label: "Dummy", description: "dummy", steps: [{ effectRef: "rollHands" }] },
        ],
      },
      flow: {
        root: { kind: "game", children: [{ kind: "loop", count: 1, children: [DUMMY_TURN] }] },
      },
    };
    expect(actorErrors(raw)).toHaveLength(0);
  });
});
