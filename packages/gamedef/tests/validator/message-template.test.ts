/**
 * MessageTemplate validator — message templates may only use tokens the runtime resolves.
 */

import { describe, expect, it } from "@jest/globals";
import { validate } from "../../src/validator/index.js";

const META = { name: "Test Game", playerCount: { min: 2, max: 2 } };

const STATE = {
  game: { properties: [{ id: "round", type: { kind: "number" }, default: 1 }] },
  player: { properties: [{ id: "score", type: { kind: "number" }, default: 0 }] },
};

const message = (template: string, extra: Record<string, unknown> = {}) => ({
  effect: "message",
  to: "all",
  template,
  ...extra,
});

function specWith(namedTemplate: string, actionStepTemplate?: string) {
  return {
    metadata: META,
    state: STATE,
    effects: { effects: [message(namedTemplate, { id: "announce" })] },
    actions: {
      actions: [
        {
          id: "bid",
          steps: [
            { input: "amount", type: { kind: "number", min: 1, max: 3 } },
            ...(actionStepTemplate === undefined ? [] : [message(actionStepTemplate)]),
            { effectRef: "announce" },
          ],
        },
      ],
    },
    flow: {
      root: {
        kind: "game",
        children: [{ kind: "loop", count: 1, children: [{ kind: "turn", actor: "all", grammar: { kind: "action", ref: "bid" } }] }],
      },
    },
  };
}

const templateErrors = (raw: unknown) => validate(raw).errors.filter((e) => e.path.endsWith(".template"));

describe("MessageTemplate — supported tokens", () => {
  it("accepts input, game property, player property and the reserved winners tokens", () => {
    const errors = templateErrors(
      specWith(
        "Round {{state.game.property.round}}: {{state.players.alice.property.score}} {{ state.game.property.winners }}",
        "Bid {{input.amount}}",
      ),
    );
    expect(errors).toEqual([]);
  });

  it("accepts a template with no tokens", () => {
    expect(templateErrors(specWith("Game on."))).toEqual([]);
  });
});

describe("MessageTemplate — unsupported tokens", () => {
  it("rejects a winners path the runtime does not resolve", () => {
    const errors = templateErrors(specWith("The winner is {{game.winners[0]}}!"));
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("invalid-template-token");
    expect(errors[0].path).toBe("effects.effects[0].template");
    expect(errors[0].message).toContain("{{game.winners[0]}}");
  });

  it("rejects each part of a helper block as its own token", () => {
    const errors = templateErrors(specWith("{{#if state.game.property.round}}yes{{else}}no{{/if}}"));
    expect(errors.map((e) => e.code)).toEqual(["invalid-template-token", "invalid-template-token", "invalid-template-token"]);
    expect(errors[0].message).toContain("no helpers or conditionals");
  });

  it("rejects a path with the wrong number of segments", () => {
    expect(templateErrors(specWith("{{state.game.property}}"))).toHaveLength(1);
    expect(templateErrors(specWith("{{state.players.property.score}}"))).toHaveLength(1);
  });

  it("checks messages inline in action steps and in flow hooks", () => {
    const spec = specWith("ok", "{{actor.id}}") as ReturnType<typeof specWith> & { flow: { root: Record<string, unknown> } };
    spec.flow.root.hooks = { onEnter: [message("{{nope}}")] };
    const paths = templateErrors(spec).map((e) => e.path);
    expect(paths).toContain("actions.actions[0].steps[1].template");
    expect(paths).toContain("flow.root.hooks.onEnter[0].template");
  });
});

describe("MessageTemplate — unresolved ids", () => {
  it("reports an unknown game property as unresolved-ref with the known ids", () => {
    const errors = templateErrors(specWith("{{state.game.property.rnd}}"));
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("unresolved-ref");
    expect(errors[0].knownIds).toEqual(["round", "winners"]);
  });

  it("reports an unknown player property as unresolved-ref with the known ids", () => {
    const errors = templateErrors(specWith("{{state.players.alice.property.scor}}"));
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("unresolved-ref");
    expect(errors[0].knownIds).toEqual(["eliminated", "score"]);
  });

  it("reports an unknown input in an action step, but not in a named effect", () => {
    const inline = templateErrors(specWith("Bid {{input.anything}}", "Bid {{input.amout}}"));
    expect(inline).toHaveLength(1);
    expect(inline[0].path).toBe("actions.actions[0].steps[1].template");
    expect(inline[0].code).toBe("unresolved-ref");
    expect(inline[0].knownIds).toEqual(["amount"]);
  });
});
