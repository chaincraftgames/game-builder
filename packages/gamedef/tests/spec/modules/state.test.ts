import { PlayerStateSchema } from "#gamedef/modules/state.js";

describe("PlayerStateSchema — reserved properties", () => {
  it("rejects declaring the built-in 'eliminated' property", () => {
    const result = PlayerStateSchema.safeParse({
      properties: [{ id: "eliminated", type: { kind: "boolean" }, default: false }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain("built-in player property");
  });

  it("accepts ordinary player properties", () => {
    const result = PlayerStateSchema.safeParse({
      properties: [{ id: "score", type: { kind: "number" }, default: 0 }],
    });
    expect(result.success).toBe(true);
  });
});
