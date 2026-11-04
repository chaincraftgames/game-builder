import { describe, expect, it } from "@jest/globals";
import { z } from "zod";
import { schemaIssues } from "../../src/validator/schema-issues.js";
import { ActionStepSchema, EffectCallSchema, keyedBranchesOf } from "../../src/index.js";

const Choice = z.union([
  z.enum(["a", "b"]),
  z.object({ x: z.string() }).strict(),
  z.object({ y: z.number() }).strict(),
]);

describe("schemaIssues", () => {
  it("keeps the union issue when several branches could have matched", () => {
    const parsed = Choice.safeParse({ z: 1 });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(schemaIssues(parsed.error).map((i) => i.code)).toEqual(["invalid_union"]);
  });

  it("reports the uniquely closest branch when several could have matched", () => {
    const parsed = Choice.safeParse({ x: "ok", extra: 1 });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(schemaIssues(parsed.error).map((i) => [i.path.join("."), i.code])).toEqual([
      ["", "unrecognized_keys"],
    ]);
  });

  it("reports the one branch that fits the input kind, at the union's path", () => {
    const stringOrObject = z.union([z.enum(["a", "b"]), z.object({ x: z.string() }).strict()]);
    const parsed = z.object({ t: stringOrObject }).safeParse({ t: { x: 5 } });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(schemaIssues(parsed.error).map((i) => [i.path.join("."), i.code])).toEqual([["t.x", "invalid_type"]]);
  });

  it("leaves non-union issues untouched", () => {
    const parsed = z.object({ n: z.number() }).safeParse({ n: "1" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(schemaIssues(parsed.error).map((i) => [i.path.join("."), i.code])).toEqual([["n", "invalid_type"]]);
  });
});

describe("keyedBranchesOf", () => {
  const keys = (schema: z.ZodType) => Object.keys(keyedBranchesOf(schema)!).sort();

  it("exposes branches, also on a .describe() copy", () => {
    expect(keys(ActionStepSchema)).toEqual(["effect", "effectRef", "input"]);
    expect(keys(EffectCallSchema.describe("copied"))).toEqual(["effect", "effectRef"]);
  });

  it("is undefined for other schemas", () => {
    expect(keyedBranchesOf(z.string())).toBeUndefined();
  });
});
