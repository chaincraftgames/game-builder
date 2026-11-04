import {
  ActionStepSchema,
  ConditionExpressionSchema,
  EffectCallSchema,
  EffectSchema,
  FlowNodeSchema,
  ModularGameSpecSchema,
  NamedEffectSchema,
  TurnGrammarNodeSchema,
  keyedBranchesOf,
  keyedUnion,
} from "@chaincraft/gamedef";
import { z } from "zod";
import { getRegistry, moduleKeys } from "#authoring/docs/registry.js";
import { descriptionOf, firstSentence, renderType, variantsOf } from "#authoring/docs/render-type.js";

describe("firstSentence", () => {
  it("stops at the first sentence end", () => {
    expect(firstSentence("One. Two.")).toBe("One.");
  });

  it("does not stop at e.g. or i.e.", () => {
    expect(firstSentence("Use e.g. this, i.e. that. Next.")).toBe("Use e.g. this, i.e. that.");
  });

  it("returns text without a sentence end whole", () => {
    expect(firstSentence("No end")).toBe("No end");
  });
});

describe("renderType", () => {
  const moduleSchema = (key: string): z.ZodType =>
    (ModularGameSpecSchema.shape as Record<string, z.ZodType>)[key];
  const variant = (kind: string, description: string) =>
    z.strictObject({ kind: z.literal(kind), value: z.string() }).describe(description);

  it("renders an object as one line per field", () => {
    const schema = z
      .strictObject({
        count: z.number().int().min(0).describe("How many."),
        mode: z.enum(["a", "b"]).default("a"),
        tags: z.array(z.string()).min(1).optional(),
        note: z.string().nullable(),
        pick: z.literal("x"),
      })
      .describe("Root object.");
    expect(renderType(schema)).toBe(
      [
        "Root object.",
        "",
        "- `count` (required) number int ≥0 — How many.",
        "- `mode` (optional, default \"a\") \"a\" | \"b\"",
        "- `tags` (optional) string[] (min 1)",
        "- `note` (required) string | null",
        "- `pick` (required) \"x\"",
        "",
      ].join("\n"),
    );
  });

  it("takes the outermost description on the wrapper chain", () => {
    const schema = z.strictObject({ a: z.string().describe("inner").optional().describe("outer") });
    expect(renderType(schema)).toContain("- `a` (optional) string — outer");
  });

  it("gives each variant of a small discriminated union a section", () => {
    const text = renderType(z.discriminatedUnion("kind", [variant("a", "First."), variant("b", "Second.")]));
    expect(text).toContain("## kind: a\n\nFirst.\n\n- `value` (required) string");
    expect(text).toContain("## kind: b\n\nSecond.\n\n- `value` (required) string");
  });

  it("renders a large discriminated union as a table", () => {
    const kinds = ["a", "b", "c", "d", "e"];
    const text = renderType(z.discriminatedUnion("kind", kinds.map((kind) => variant(kind, `Kind ${kind}. More.`)) as never));
    expect(text).toContain("| `kind` | Description |");
    expect(text).toContain("| `a` | Kind a. |");
    expect(text).not.toContain("`value`");
  });

  it("lists the options of a plain union, expanding object options", () => {
    const schema = z.strictObject({
      pick: z.union([z.literal("all").describe("Everyone."), z.strictObject({ roles: z.array(z.string()) })]),
    });
    expect(renderType(schema)).toContain(
      ["- `pick` (required) one of", "  - \"all\" — Everyone.", "  - `{ roles }`", "    - `roles` (required) string[]"].join("\n"),
    );
  });

  it("expands anonymous objects only two levels below the root", () => {
    const schema = z.strictObject({
      a: z.strictObject({ b: z.strictObject({ c: z.strictObject({ d: z.string() }) }) }),
    });
    const text = renderType(schema);
    expect(text).toContain("- `c` (required) object");
    expect(text).not.toContain("`d`");
  });

  it("stops at a recursive schema instead of looping", () => {
    type Tree = { children: Tree[] };
    const tree: z.ZodType<Tree> = z.lazy(() => z.strictObject({ children: z.array(tree) }));
    expect(renderType(tree)).toContain("- `children` (required) object[]");
  });

  it("throws on a Zod node type it cannot render", () => {
    expect(() => renderType(z.strictObject({ s: z.set(z.string()) }))).toThrow(/unhandled Zod node type "set"/);
  });

  it("returns only the label with expandRoot false", () => {
    expect(renderType(FlowNodeSchema, { expandRoot: false })).toBe("`FlowNode`");
  });

  it("renders every named type without throwing", () => {
    for (const schema of getRegistry().schemas.values()) expect(() => renderType(schema)).not.toThrow();
  });

  it("renders every module without throwing", () => {
    for (const key of moduleKeys()) expect(() => renderType(moduleSchema(key))).not.toThrow();
  });

  it("renders the recursive flow and grammar nodes", () => {
    expect(renderType(FlowNodeSchema)).toContain("## kind: loop");
    expect(renderType(TurnGrammarNodeSchema)).toContain("| `repeat` |");
  });

  it("expands a named type at most once per page", () => {
    for (const key of moduleKeys()) {
      const headings = [...renderType(moduleSchema(key)).matchAll(/^## (\S+)$/gm)].map((match) => match[1]);
      expect(headings.filter((heading, i) => headings.indexOf(heading) !== i)).toEqual([]);
    }
  });

  it("shows the flow node kinds and hook descriptions on the flow page", () => {
    const text = renderType(moduleSchema("flow"));
    for (const [kind] of variantsOf(FlowNodeSchema)!.variants) expect(text).toContain(`## kind: ${kind}`);
    expect(text).toContain("Effects executed when this flow node is entered.");
    expect(text).toContain("Effects executed when this flow node completes.");
  });

  it("shows the effects as a variant table on the effects page", () => {
    const text = renderType(moduleSchema("effects"));
    expect(text).toContain("| `effect` | Description |");
    for (const option of EffectSchema.options) {
      expect(text).toContain(`| \`${option.shape.effect.value}\` |`);
    }
  });

  it("renders the derived NamedEffect as an Effect variant plus its extra fields", () => {
    const text = renderType(NamedEffectSchema);
    expect(text).toContain("Any `Effect` variant, plus:");
    expect(text).toContain("- `id` (required) `Identifier`");
    expect(text).not.toContain("## effect:");
  });

  it("renders a keyed union as its branches", () => {
    const text = renderType(ActionStepSchema);
    expect(text).toContain("One of, chosen by which key is present:");
    expect(text).toContain("- `input` → `ActionInput`");
    expect(text).toContain("- `effectRef` → `EffectCallRef`");
    expect(text).toContain("## ActionInput");
  });

  it("names the choosing keys of a named keyed union on the actions page", () => {
    const text = renderType(moduleSchema("actions"));
    expect(text).toMatch(/^- `steps` \(required\) `ActionStep`\[\]/m);
    expect(text).toContain("## ActionStep\n");
    expect(text).toContain("One of, chosen by which key is present:\n- `input` → `ActionInput`\n- `effect` → `Effect`\n- `effectRef` → `EffectCallRef`");
  });

  it("names the choosing keys on the field line of an anonymous keyed union", () => {
    const schema = z.strictObject({
      step: keyedUnion({ a: z.strictObject({ a: z.string() }), b: z.strictObject({ b: z.number() }) }),
    });
    expect(renderType(schema)).toContain("- `step` (required) one of, chosen by which key is present: `a` → object, `b` → object");
  });

  it("renders the branches of EffectCall, not unknown", () => {
    expect(renderType(EffectCallSchema)).toContain("- `effectRef` → `EffectCallRef`");
  });

  it("shows a named type's own description once, as one sentence after its first link", () => {
    const text = renderType(z.strictObject({ a: ConditionExpressionSchema, b: ConditionExpressionSchema }));
    const sentence = firstSentence(ConditionExpressionSchema.description!);
    expect(text).toContain(`- \`a\` (required) \`ConditionExpression\` — ${sentence}\n`);
    expect(text).toContain("- `b` (required) `ConditionExpression`\n");
  });
});

describe("field descriptions", () => {
  /** Recorded count of undescribed fields; it may only go down, and only by describing fields. Set PRINT_UNDESCRIBED=1 to list them. */
  const BASELINE = 21;

  /** Every object field in the spec tree with no description, as `Owner.field` (owner = nearest named type). */
  const undescribedFields = (): string[] => {
    const registry = getRegistry();
    const visited = new Set<unknown>();
    const missing = new Set<string>();
    const walk = (schema: z.ZodType, owner: string, skip?: string): void => {
      let current = schema;
      let scope = owner;
      for (;;) {
        scope = registry.nameOf(current) ?? scope;
        const branches = keyedBranchesOf(current);
        if (branches !== undefined) {
          for (const [key, branch] of Object.entries(branches)) walk(branch, `${scope}<${key}>`);
          return;
        }
        const def = (current as unknown as { _zod: { def: Record<string, any> } })._zod.def;
        if (def.type === "lazy") {
          // A lazy getter builds a new schema per call, so the lazy def itself guards the cycle.
          if (visited.has(def)) return;
          visited.add(def);
          current = def.getter();
        } else if (["optional", "nullable", "default", "readonly"].includes(def.type)) {
          current = def.innerType;
        } else {
          break;
        }
      }
      const def = (current as unknown as { _zod: { def: Record<string, any> } })._zod.def;
      if (visited.has(def)) return;
      visited.add(def);
      if (def.type === "array") walk(def.element, scope);
      else if (def.type === "record") walk(def.valueType, scope);
      else if (def.type === "union") def.options.forEach((option: z.ZodType, i: number) => walk(option, `${scope}|${i}`, def.discriminator));
      else if (def.type === "object") {
        for (const [key, field] of Object.entries(def.shape as Record<string, z.ZodType>)) {
          if (key === skip) continue;
          if (descriptionOf(field) === undefined) missing.add(`${scope}.${key}`);
          walk(field, `${scope}.${key}`);
        }
      }
    };
    walk(ModularGameSpecSchema, "spec");
    return [...missing].sort();
  };

  it("has no more undescribed fields than the recorded baseline", () => {
    const missing = undescribedFields();
    if (process.env.PRINT_UNDESCRIBED) console.log(`${missing.length} undescribed fields:\n${missing.join("\n")}`);
    expect(missing.length).toBeLessThanOrEqual(BASELINE);
  });
});
