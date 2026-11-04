/**
 * Every object in the spec tree is closed: an unknown key is a schema error, never silently dropped.
 */

import { z } from "zod";
import { ModularGameSpecSchema } from "#gamedef/index.js";
import { keyedBranchesOf } from "#gamedef/modules/common.js";

/** Zod v4 definition node; only the fields this walk reads. */
type Def = {
  type: string;
  shape?: Record<string, z.ZodType>;
  catchall?: z.ZodType;
  innerType?: z.ZodType;
  element?: z.ZodType;
  valueType?: z.ZodType;
  options?: z.ZodType[];
  items?: z.ZodType[];
  getter?: () => z.ZodType;
  in?: z.ZodType;
  out?: z.ZodType;
  left?: z.ZodType;
  right?: z.ZodType;
};

const defOf = (schema: z.ZodType): Def => (schema as unknown as { _zod: { def: Def } })._zod.def;

/** Node types with nothing to descend into. */
const LEAVES = new Set(["string", "number", "boolean", "enum", "literal", "unknown", "any", "null", "transform"]);

/** Paths of every object node that does not reject unknown keys. */
function nonStrictObjects(root: z.ZodType): string[] {
  const found: string[] = [];
  const seen = new Set<unknown>();

  const walk = (schema: z.ZodType, path: string): void => {
    if (seen.has(schema)) return;
    seen.add(schema);

    const branches = keyedBranchesOf(schema);
    if (branches) {
      for (const [key, branch] of Object.entries(branches)) walk(branch, `${path}|${key}`);
      return;
    }

    const def = defOf(schema);
    switch (def.type) {
      case "object":
        if (def.catchall === undefined || defOf(def.catchall).type !== "never") found.push(path || "(root)");
        for (const [key, field] of Object.entries(def.shape ?? {})) walk(field, `${path}.${key}`);
        return;
      case "optional":
      case "nullable":
      case "default":
      case "readonly":
        return walk(def.innerType!, path);
      case "array":
        return walk(def.element!, `${path}[]`);
      case "record":
        return walk(def.valueType!, `${path}{}`);
      case "union":
        def.options!.forEach((option, i) => walk(option, `${path}#${i}`));
        return;
      case "tuple":
        def.items!.forEach((item, i) => walk(item, `${path}[${i}]`));
        return;
      case "lazy":
        // A `.describe()` clone made inside a getter is a new instance every call; the getter is the identity.
        if (seen.has(def.getter)) return;
        seen.add(def.getter);
        return walk(def.getter!(), path);
      case "pipe":
        walk(def.in!, path);
        return walk(def.out!, path);
      case "intersection":
        walk(def.left!, path);
        return walk(def.right!, path);
      default:
        if (!LEAVES.has(def.type)) throw new Error(`unhandled Zod node type "${def.type}" at ${path}`);
    }
  };

  walk(root, "");
  return found;
}

describe("strict objects", () => {
  it("every object in ModularGameSpecSchema rejects unknown keys", () => {
    expect(nonStrictObjects(ModularGameSpecSchema)).toEqual([]);
  });

  it("detects an object that drops unknown keys", () => {
    expect(nonStrictObjects(z.object({ a: z.string() }))).toEqual(["(root)"]);
    expect(nonStrictObjects(z.object({ a: z.string() }).strict())).toEqual([]);
    expect(nonStrictObjects(z.strictObject({ inner: z.array(z.object({})) }))).toEqual([".inner[]"]);
  });
});
