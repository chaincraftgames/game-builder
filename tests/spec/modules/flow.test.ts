/**
 * Parse tests for FlowModuleSchema.
 *
 * Exercises:
 *   - FlowNodeSchema: loop, turn, simultaneous
 *   - TurnGrammarNodeSchema: action, slot, sequence, choice (passable), repeat
 *   - TurnOrder variants
 *   - ActorSpec variants
 *   - FlowHooks (onEnter/onComplete)
 *   - endCondition (infix expression or "until-pass") and count on loop
 *   - interruptWindows on nodes (scoped)
 *   - Full Liar's Dice flow
 *   - Full Werewolf (night/day) flow
 *   - Rejection cases
 */

import { FlowModuleSchema } from "#gamedef/modules/flow.js";

function ok(data: unknown) {
  const result = FlowModuleSchema.safeParse(data);
  if (!result.success) throw new Error(JSON.stringify(result.error.format(), null, 2));
  return result.data;
}

function fail(data: unknown) {
  const result = FlowModuleSchema.safeParse(data);
  expect(result.success).toBe(false);
}

// Wrap a single child node in a minimal game root
function baseLoop(child: any): any {
  return {
    root: {
      kind: "game",
      children: [child],
    },
  };
}

// ---------------------------------------------------------------------------
// Liar's Dice
// ---------------------------------------------------------------------------

describe("FlowModuleSchema — Liar's Dice", () => {
  const liarsFlow = {
    root: {
      kind: "game",
      hooks: { onEnter: [{ effectRef: "dealDice" }] },
      interruptWindows: [
        {
          id: "stealResponse",
          trigger: "stealDie",
          timing: "before",
          eligiblePlayers: "opponents",
          actions: ["blockSteal"],
          timeout: 15000,
        },
      ],
      children: [
        {
          kind: "loop",
          endCondition: "game.property.activePlayers <= 1",
          children: [
            {
              kind: "turn",
              actor: "all-players",
              turnOrder: { kind: "seat", direction: "clockwise" },
              grammar: {
                kind: "choice",
                passable: true,
                options: [
                  { kind: "action", ref: "makeBid" },
                  { kind: "action", ref: "challenge" },
                ],
              },
            },
          ],
        },
      ],
    },
  };

  it("parses a valid Liar's Dice flow", () => {
    const result = ok(liarsFlow);
    expect(result.root.kind).toBe("game");
  });

  it("preserves interrupt windows on the loop node", () => {
    const result = ok(liarsFlow);
    const root = result.root as any;
    expect(root.interruptWindows).toHaveLength(1);
    expect(root.interruptWindows[0].id).toBe("stealResponse");
  });

  it("preserves children", () => {
    const result = ok(liarsFlow);
    const root = result.root as any;
    expect(root.children).toHaveLength(1);
    expect(root.children[0].kind).toBe("loop");
  });
});

// ---------------------------------------------------------------------------
// Werewolf
// ---------------------------------------------------------------------------

describe("FlowModuleSchema — Werewolf", () => {
  const werewolfFlow = {
    root: {
      kind: "game",
      children: [
        {
          kind: "loop",
          endCondition: "game.property.gameOver == true",
          children: [
            {
              kind: "simultaneous",
              id: "night",
              label: "Night Phase",
              actor: { roles: ["villager", "mafia"] },
              grammar: {
                kind: "slot",
                inventory: "roleCard",
                slot: "nightAction",
                select: "all",
              },
            },
            {
              kind: "simultaneous",
              id: "dayDiscussion",
              label: "Discussion",
              actor: "all-players",
              endCondition: "all-passed",
              grammar: {
                kind: "choice",
                passable: true,
                options: [{ kind: "action", ref: "accusePlayer" }],
              },
            },
            {
              kind: "simultaneous",
              id: "dayVote",
              label: "Vote",
              actor: "all-players",
              grammar: { kind: "action", ref: "voteEliminate" },
              hooks: {
                onComplete: [{ effectRef: "revealEliminated" }, { effectRef: "removeEliminated" }],
              },
            },
          ],
        },
      ],
    },
  };

  it("parses a valid Werewolf flow", () => {
    const result = ok(werewolfFlow);
    const night = (result.root as any).children[0].children[0];
    expect(night.actor.roles).toContain("villager");
  });

  it("parses endCondition: 'all-passed' on simultaneous", () => {
    const result = ok(werewolfFlow);
    const discussion = (result.root as any).children[0].children[1];
    expect(discussion.endCondition).toBe("all-passed");
  });
});

// ---------------------------------------------------------------------------
// Loop exit: count vs endCondition
// ---------------------------------------------------------------------------

describe("FlowModuleSchema — Loop exit", () => {
  it("parses loop with count", () => {
    const result = ok({
      root: {
        kind: "game",
        children: [{ kind: "loop", count: 5, children: [{ kind: "turn", actor: "all-players", grammar: { kind: "action", ref: "noop" } }] }],
      },
    });
    expect((result.root as any).children[0].count).toBe(5);
  });

  it("parses loop with count: 1 (single round)", () => {
    const result = ok({
      root: {
        kind: "game",
        children: [{ kind: "loop", count: 1, children: [{ kind: "turn", actor: "all-players", grammar: { kind: "action", ref: "noop" } }] }],
      },
    });
    expect((result.root as any).children[0].count).toBe(1);
  });

  it("parses loop with infix expression endCondition", () => {
    const result = ok({
      root: {
        kind: "game",
        children: [{ kind: "loop", endCondition: "game.property.round >= 5", children: [{ kind: "turn", actor: "all-players", grammar: { kind: "action", ref: "noop" } }] }],
      },
    });
    expect((result.root as any).children[0].endCondition).toBe("game.property.round >= 5");
  });

  it("parses loop with endCondition: 'until-pass'", () => {
    const result = ok({
      root: {
        kind: "game",
        children: [{
          kind: "loop",
          endCondition: "all-passed",
          children: [
            {
              kind: "simultaneous",
              actor: "all-players",
              grammar: { kind: "choice", passable: true, options: [{ kind: "action", ref: "noop" }] },
            },
          ],
        }],
      },
    });
    expect((result.root as any).children[0].endCondition).toBe("all-passed");
  });

  it("parses loop with finalRound: true", () => {
    const result = ok({
      root: {
        kind: "game",
        children: [{
          kind: "loop",
          endCondition: "actor.property.score >= 50",
          checkAfter: "turn",
          finalRound: true,
          children: [{ kind: "turn", actor: "all-players", turnOrder: { kind: "seat", direction: "clockwise" }, grammar: { kind: "action", ref: "takeTurn" } }],
        }],
      },
    });
    expect((result.root as any).children[0].finalRound).toBe(true);
  });

  it("parses count: 1 root with two child phase loops (multi-phase game)", () => {
    const result = ok({
      root: {
        kind: "game",
        children: [
          {
            kind: "loop",
            id: "exploration",
            endCondition: "game.property.hauntTriggered == true",
            finalRound: true,
            children: [{ kind: "turn", actor: "all-players", grammar: { kind: "action", ref: "explore" } }],
          },
          {
            kind: "loop",
            id: "escape",
            endCondition: "game.property.gameOver == true",
            children: [{ kind: "turn", actor: "all-players", grammar: { kind: "action", ref: "escape" } }],
          },
        ],
      },
    });
    const root = result.root as any;
    expect(root.children[0].id).toBe("exploration");
    expect(root.children[0].finalRound).toBe(true);
    expect(root.children[1].id).toBe("escape");
  });

  it("rejects loop with empty children", () => {
    fail(baseLoop({ kind: "loop", count: 1, children: [] }));
  });
});

// ---------------------------------------------------------------------------
// Interrupt windows on nodes (scoped)
// ---------------------------------------------------------------------------

describe("FlowModuleSchema — Scoped interrupt windows", () => {
  it("parses interruptWindows on root loop", () => {
    const result = ok({
      root: {
        kind: "game",
        interruptWindows: [
          {
            id: "globalResponse",
            trigger: "takeDamage",
            timing: "after",
            eligiblePlayers: "all",
            actions: ["respond"],
          },
        ],
        children: [{ kind: "loop", count: 3, children: [{ kind: "turn", actor: "all-players", grammar: { kind: "action", ref: "noop" } }] }],
      },
    });
    expect((result.root as any).interruptWindows).toHaveLength(1);
  });

  it("parses interruptWindows on a turn node", () => {
    const result = ok(
      baseLoop({
        kind: "turn",
        id: "attackTurn",
        actor: "all-players",
        grammar: { kind: "action", ref: "attack" },
        interruptWindows: [
          {
            id: "counterSpell",
            trigger: "dealDamage",
            timing: "before",
            eligiblePlayers: "opponents",
            actions: ["counterSpell"],
          },
        ],
      }),
    );
    const turn = (result.root as any).children[0];
    expect(turn.interruptWindows[0].id).toBe("counterSpell");
  });

  it("parses interruptWindows on a simultaneous node", () => {
    const result = ok(
      baseLoop({
        kind: "simultaneous",
        actor: "all-players",
        grammar: { kind: "action", ref: "noop" },
        interruptWindows: [
          {
            id: "simWindow",
            trigger: "someEffect",
            timing: "after",
            eligiblePlayers: { roles: ["healer"] },
            actions: ["heal"],
          },
        ],
      }),
    );
    const sim = (result.root as any).children[0];
    expect(sim.interruptWindows[0].eligiblePlayers.roles).toContain("healer");
  });

  it("parses interruptWindow with eligiblePlayers: 'non-active'", () => {
    const result = ok(
      baseLoop({
        kind: "turn",
        actor: "all-players",
        grammar: { kind: "action", ref: "noop" },
        interruptWindows: [
          {
            id: "nonActiveWindow",
            trigger: "someEffect",
            timing: "before",
            eligiblePlayers: "non-active",
            actions: ["respond"],
          },
        ],
      }),
    );
    const turn = (result.root as any).children[0];
    expect(turn.interruptWindows[0].eligiblePlayers).toBe("non-active");
  });
});

// ---------------------------------------------------------------------------
// Turn grammar
// ---------------------------------------------------------------------------

describe("FlowModuleSchema — Turn Grammar", () => {
  it("parses action grammar", () => {
    const result = ok(baseLoop({ kind: "turn", actor: "all-players", grammar: { kind: "action", ref: "playCard" } }));
    expect((result.root as any).children[0].grammar.ref).toBe("playCard");
  });

  it("parses slot grammar with select: 'all'", () => {
    const result = ok(baseLoop({
      kind: "turn", actor: "all-players",
      grammar: { kind: "slot", inventory: "hand", slot: "cardAbility", select: "all" },
    }));
    expect((result.root as any).children[0].grammar.select).toBe("all");
  });

  it("parses slot grammar with select: { max: 2 }", () => {
    const result = ok(baseLoop({
      kind: "turn", actor: "all-players",
      grammar: { kind: "slot", inventory: "hand", slot: "cardAbility", select: { max: 2 } },
    }));
    expect((result.root as any).children[0].grammar.select.max).toBe(2);
  });

  it("parses sequence", () => {
    const result = ok(baseLoop({
      kind: "turn", actor: "all-players",
      grammar: { kind: "sequence", steps: [{ kind: "action", ref: "draw" }, { kind: "action", ref: "play" }] },
    }));
    expect((result.root as any).children[0].grammar.steps).toHaveLength(2);
  });

  it("parses choice with passable: true", () => {
    const result = ok(baseLoop({
      kind: "turn", actor: "all-players",
      grammar: { kind: "choice", passable: true, options: [{ kind: "action", ref: "playCard" }] },
    }));
    expect((result.root as any).children[0].grammar.passable).toBe(true);
  });

  it("parses repeat with count: { max: 3 }", () => {
    const result = ok(baseLoop({
      kind: "turn", actor: "all-players",
      grammar: {
        kind: "repeat",
        count: { max: 3 },
        body: { kind: "choice", passable: true, options: [{ kind: "action", ref: "playCard" }] },
      },
    }));
    expect((result.root as any).children[0].grammar.count.max).toBe(3);
  });

  it("parses repeat with count: 'until-pass'", () => {
    const result = ok(baseLoop({
      kind: "turn", actor: "all-players",
      grammar: {
        kind: "repeat",
        count: "until-pass",
        body: { kind: "choice", passable: true, options: [{ kind: "action", ref: "playCard" }] },
      },
    }));
    expect((result.root as any).children[0].grammar.count).toBe("until-pass");
  });
});

// ---------------------------------------------------------------------------
// TurnOrder variants
// ---------------------------------------------------------------------------

describe("FlowModuleSchema — TurnOrder", () => {
  it("parses seat order", () => {
    const result = ok(baseLoop({
      kind: "turn", actor: "all-players",
      turnOrder: { kind: "seat", direction: "clockwise" },
      grammar: { kind: "action", ref: "noop" },
    }));
    expect((result.root as any).children[0].turnOrder.kind).toBe("seat");
  });

  it("parses ranked order", () => {
    const result = ok(baseLoop({
      kind: "turn", actor: "all-players",
      turnOrder: { kind: "ranked", by: { playerProperty: "gold" }, order: "ascending" },
      grammar: { kind: "action", ref: "noop" },
    }));
    expect((result.root as any).children[0].turnOrder.kind).toBe("ranked");
  });

  it("parses explicit order", () => {
    const result = ok(baseLoop({
      kind: "turn", actor: "all-players",
      turnOrder: { kind: "explicit", players: ["north", "east", "south", "west"] },
      grammar: { kind: "action", ref: "noop" },
    }));
    expect((result.root as any).children[0].turnOrder.players).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Rejection cases
// ---------------------------------------------------------------------------

describe("FlowModuleSchema — Rejection cases", () => {
  it("rejects loop with empty children", () => {
    fail({ root: { kind: "game", children: [{ kind: "loop", count: 1, children: [] }] } });
  });

  it("rejects turn with no actor", () => {
    fail(baseLoop({ kind: "turn", grammar: { kind: "action", ref: "noop" } }));
  });

  it("rejects simultaneous with no actor", () => {
    fail(baseLoop({ kind: "simultaneous", grammar: { kind: "action", ref: "noop" } }));
  });

  it("rejects turn with no grammar", () => {
    fail(baseLoop({ kind: "turn", actor: "all-players" }));
  });

  it("rejects choice with no options", () => {
    fail(baseLoop({ kind: "turn", actor: "all-players", grammar: { kind: "choice", options: [] } }));
  });

  it("rejects repeat with count: 0", () => {
    fail(baseLoop({
      kind: "turn", actor: "all-players",
      grammar: { kind: "repeat", count: 0, body: { kind: "action", ref: "noop" } },
    }));
  });

  it("rejects interruptWindow with empty actions", () => {
    fail(baseLoop({
      kind: "turn", actor: "all-players",
      grammar: { kind: "action", ref: "noop" },
      interruptWindows: [{ id: "w", trigger: "e", timing: "before", eligiblePlayers: "all", actions: [] }],
    }));
  });

  it("rejects actor: { roles: [] }", () => {
    fail(baseLoop({ kind: "turn", actor: { roles: [] }, grammar: { kind: "action", ref: "noop" } }));
  });
});

// ---------------------------------------------------------------------------
// Win conditions
// ---------------------------------------------------------------------------

const baseGame = (winConditions: unknown[]) => ({
  root: {
    kind: "game",
    winConditions,
    children: [{ kind: "loop", count: 1, children: [{ kind: "turn", actor: "all-players", grammar: { kind: "action", ref: "noop" } }] }],
  },
});

describe("FlowModuleSchema — winConditions", () => {
  it("accepts a ranking win condition (highest score)", () => {
    const result = ok(baseGame([{ rule: "ranking", property: "player.property.score" }]));
    const wc = result.root.winConditions![0] as any;
    expect(wc.rule).toBe("ranking");
    expect(wc.property).toBe("player.property.score");
    expect(wc.order).toBe("highest");       // default
    expect(wc.tiebreak).toBe("all-win");    // default
  });

  it("accepts a ranking win condition (lowest wins)", () => {
    const result = ok(baseGame([{ rule: "ranking", property: "player.property.penalties", order: "lowest" }]));
    expect((result.root.winConditions![0] as any).order).toBe("lowest");
  });

  it("accepts a per-player condition win condition", () => {
    const result = ok(baseGame([{
      rule: "condition",
      condition: "count(player.inventory.escaped) >= 1",
    }]));
    expect((result.root.winConditions![0] as any).rule).toBe("condition");
  });

  it("accepts a role-condition win condition (asymmetric)", () => {
    const result = ok(baseGame([
      {
        rule: "role-condition",
        condition: "game.property.wolfCount >= game.property.villagerCount",
        winners: { roles: ["werewolf"] },
      },
      {
        rule: "role-condition",
        condition: "game.property.wolfCount < game.property.villagerCount",
        winners: { roles: ["villager"] },
      },
    ]));
    expect(result.root.winConditions).toHaveLength(2);
    expect((result.root.winConditions![0] as any).winners.roles).toEqual(["werewolf"]);
  });

  it("accepts multiple mixed win conditions", () => {
    const result = ok(baseGame([
      { rule: "ranking", property: "player.property.score" },
      { rule: "condition", condition: "player.property.score >= 100" },
    ]));
    expect(result.root.winConditions).toHaveLength(2);
  });

  it("accepts a game with no winConditions", () => {
    const result = ok({
      root: {
        kind: "game",
        children: [{ kind: "loop", count: 1, children: [{ kind: "turn", actor: "all-players", grammar: { kind: "action", ref: "noop" } }] }],
      },
    });
    expect(result.root.winConditions).toBeUndefined();
  });

  it("rejects role-condition missing winners", () => {
    fail(baseGame([{
      rule: "role-condition",
      condition: "game.property.haunted == true",
    }]));
  });

  it("rejects role-condition with empty roles", () => {
    fail(baseGame([{
      rule: "role-condition",
      condition: "game.property.haunted == true",
      winners: { roles: [] },
    }]));
  });
});
