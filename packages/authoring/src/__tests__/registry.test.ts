import {
  ActionStepSchema,
  ConditionExpressionSchema,
  EffectCallSchema,
  FlowNodeSchema,
  MoveEffectSchema,
  NamedEffectSchema,
  PlayerTargetSchema,
  keyedBranchesOf,
} from "@chaincraft/gamedef";
import { z } from "zod";
import { getRegistry, moduleKeys } from "#authoring/docs/registry.js";

describe("registry", () => {
  const registry = getRegistry();

  it("names exports without the Schema suffix", () => {
    expect(registry.schemas.get("MoveEffect")).toBe(MoveEffectSchema);
    expect(registry.schemas.has("MoveEffectSchema")).toBe(false);
  });

  it("resolves a .describe() copy to the original name", () => {
    expect(registry.nameOf(ConditionExpressionSchema.describe("copied"))).toBe("ConditionExpression");
    expect(registry.nameOf(FlowNodeSchema.describe("copied"))).toBe("FlowNode");
    expect(registry.nameOf(PlayerTargetSchema.describe("copied"))).toBe("PlayerTarget");
    expect(registry.nameOf(ActionStepSchema.describe("copied"))).toBe("ActionStep");
  });

  it("does not resolve a .strict() copy, which has no link back to its source", () => {
    expect(registry.nameOf(MoveEffectSchema.strict())).toBeUndefined();
  });

  it("does not resolve .extend(), which builds a new shape", () => {
    expect(registry.nameOf(MoveEffectSchema.extend({ extra: z.string() }))).toBeUndefined();
    expect(registry.nameOf(NamedEffectSchema.options[0])).toBeUndefined();
  });

  it("does not resolve unrelated anonymous schemas", () => {
    expect(registry.nameOf(z.string())).toBeUndefined();
    expect(registry.nameOf(z.object({}))).toBeUndefined();
  });

  it("has no two names sharing a key piece", () => {
    expect([...registry.aliases]).toEqual([]);
  });

  it("names the exports added for the reference", () => {
    const added = [
      "FlowHooks", "TurnOrder", "ActorSpec", "FlowEndCondition",
      "PlayerKeywordTarget", "ParamTarget", "StateRefTarget", "WhereTarget", "RolesTarget",
      "StateWriteTrigger", "MoveTrigger", "RevealTrigger", "SkipTurnTrigger",
      "RankingWinCondition", "ConditionWinCondition", "RoleConditionWinCondition",
      "ConversionLeg", "NumericOrVar",
      "ActionInputType", "RandomSource",
    ];
    expect(added.filter((name) => !registry.schemas.has(name))).toEqual([]);
  });

  it("exposes the branches of keyed unions", () => {
    const branchKeys = (schema: z.ZodType) => Object.keys(keyedBranchesOf(schema)!).sort();
    expect(branchKeys(ActionStepSchema)).toEqual(["effect", "effectRef", "input"]);
    expect(branchKeys(EffectCallSchema)).toEqual(["effect", "effectRef"]);
    expect(branchKeys(ActionStepSchema.describe("copied"))).toEqual(["effect", "effectRef", "input"]);
  });
});

describe("moduleKeys", () => {
  it("lists the top-level spec modules", () => {
    expect(moduleKeys()).toEqual([
      "metadata", "players", "gamepieceTypes", "inventories", "state",
      "effects", "actions", "flow", "catalog", "mechanics",
    ]);
  });
});
