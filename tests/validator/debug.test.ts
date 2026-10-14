import { validate } from "#gamedef/validator/index.js";

const META = { name: "Test Game", playerCount: { min: 2, max: 2 } };
const DUMMY_TURN = { kind: "turn", actor: "all-players", grammar: { kind: "action", ref: "dummy" } };

test("debug - duplicate flow node IDs", () => {
  const result = validate({
    metadata: META,
    flow: {
      root: {
        kind: "loop",
        count: 1,
        children: [
          { kind: "loop", id: "phase-a", count: 3, children: [DUMMY_TURN] },
          { kind: "loop", id: "phase-a", count: 3, children: [DUMMY_TURN] },
        ],
      },
    },
  });
  console.log("valid:", result.valid);
  console.log("errors:", JSON.stringify(result.errors, null, 2));
  expect(1).toBe(1);
});

test("debug - availableInSubflows", () => {
  const result = validate({
    metadata: META,
    flow: { root: { kind: "loop", count: 1, children: [DUMMY_TURN] } },
    effects: { effects: [{ id: "use-e", effect: "move", from: { inventory: "src", select: "top" }, to: { inventory: "dst" } }] },
    actions: { actions: [{ id: "use-ability", label: "use-ability", description: "use", steps: [{ effectRef: "use-e" }] }] },
    gamepieceTypes: {
      types: [
        {
          id: "card",
          visibility: "always",
          scope: { kind: "game" },
          mechanics: [
            {
              kind: "chaincraft:charges",
              slotId: "mygame:ability",
              chargeType: "energy",
              maxCharges: 3,
              count: 1,
              action: "use-ability",
              availableInSubflows: ["nonexistent-phase"],
            },
          ],
        },
      ],
    },
  });
  console.log("valid:", result.valid);
  console.log("errors:", JSON.stringify(result.errors, null, 2));
  expect(1).toBe(1);
});
