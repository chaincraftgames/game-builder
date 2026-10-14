/**
 * Parse tests for PlayersModuleSchema — focused on passives on roles.
 */

import { PlayersModuleSchema } from "#gamedef/modules/players.js";

describe("PlayersModuleSchema — role passives", () => {
  it("accepts a role with a defensive passive", () => {
    const result = PlayersModuleSchema.parse({
      roles: [
        {
          id: "paladin",
          description: "Holy warrior with damage reduction",
          assignment: { method: "player-choice" },
          visibility: { type: "public" },
          passives: [
            {
              id: "divine-protection",
              trigger: { kind: "state-write", scope: "target", path: "player.property.hp", direction: "decrease" },
              effects: [
                { effect: "adjust", adjustment: { delta: 1 } },
              ],
            },
          ],
        },
      ],
    });
    expect(result.roles![0].passives![0].id).toBe("divine-protection");
  });

  it("accepts a role with an offensive passive", () => {
    const result = PlayersModuleSchema.parse({
      roles: [
        {
          id: "berserker",
          description: "Warrior with rage-powered attacks",
          assignment: { method: "player-choice" },
          visibility: { type: "public" },
          passives: [
            {
              id: "rage-power",
              trigger: { kind: "state-write", scope: "actor", path: "player.property.hp", direction: "decrease" },
              effects: [
                {
                  effect: "adjust",
                  adjustment: { delta: { var: "player.property.rage", negate: true } },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(result.roles![0].passives![0].trigger.scope).toBe("actor");
  });

  it("accepts a role without passives", () => {
    const result = PlayersModuleSchema.parse({
      roles: [
        {
          id: "dealer",
          assignment: { method: "rotating", at: { when: "game-start" }, direction: "clockwise" },
          visibility: { type: "public" },
        },
      ],
    });
    expect(result.roles![0].passives).toBeUndefined();
  });
});
