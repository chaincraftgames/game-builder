import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ModularGameSpecSchema, keyedBranchesOf } from "@chaincraft/gamedef";
import { z } from "zod";
import { getRegistry, moduleKeys } from "#authoring/docs/registry.js";
import { renderType, variantsOf } from "#authoring/docs/render-type.js";
import { PRIMARY_UNIONS, schemaDoc, variantIds } from "#authoring/docs/schema-ref.js";

const text = (query?: string): string => {
  const result = schemaDoc(query);
  if (!result.ok) throw new Error(`"${query}" did not resolve; knownIds: ${result.knownIds.join(", ")}`);
  return result.text;
};

const knownIds = (query: string): string[] => {
  const result = schemaDoc(query);
  if (result.ok) throw new Error(`"${query}" unexpectedly resolved`);
  return result.knownIds;
};

describe("schemaDoc", () => {
  it("lists the modules and mechanic kinds with no query", () => {
    expect(text()).toMatchSnapshot();
  });

  it("marks the required modules in the index", () => {
    const index = text();
    expect(index).toMatch(/^\| `metadata` \| yes \|/m);
    expect(index).toMatch(/^\| `flow` \| yes \|/m);
    expect(index).toMatch(/^\| `catalog` \| no \|/m);
    for (const key of moduleKeys()) expect(index).toContain(`| \`${key}\` |`);
    expect(index).toContain("| `chaincraft:score-track` |");
    expect(index).toContain("| `chaincraft:charges` |");
  });

  it("renders a module key as that module's tree", () => {
    const flow = (ModularGameSpecSchema.shape as Record<string, z.ZodType>).flow;
    expect(text("flow")).toBe(renderType(flow));
  });

  it("renders the effects module as a variant table", () => {
    expect(text("effects")).toContain("| `effect` | Description |");
    expect(text("effects")).not.toContain("## effect: move");
  });

  it("renders a type name as that type's tree", () => {
    expect(text("MoveEffect")).toMatch(/^# MoveEffect\n/);
    expect(text("FlowNode")).toContain("## kind: loop");
  });

  it("renders a qualified variant", () => {
    expect(text("PassiveTrigger.move")).toBe(renderType(getRegistry().schemas.get("MoveTrigger")!));
  });

  it("heads an anonymous variant with its qualified name", () => {
    expect(text("ActionInputType.gamepiece-select")).toMatch(/^# ActionInputType\.gamepiece-select\n/);
    expect(text("gamepiece-select")).toBe(text("ActionInputType.gamepiece-select"));
  });

  it("resolves a bare value shared with a primary union to the primary one, noting the others", () => {
    const page = text("move");
    expect(page).toMatch(/^# MoveEffect\n\nAlso matches: `PassiveTrigger.move`\n\n/);
    expect(page).not.toContain("NamedEffect");
    expect(text("number")).toContain("Also matches: `ActionInputType.number`");
  });

  it("returns the qualified forms for a value no primary union settles, each of which resolves", () => {
    const ids = knownIds("condition");
    expect(ids).toEqual(["RoleAssignment.condition", "WinCondition.condition"]);
    for (const id of ids) expect(schemaDoc(id).ok).toBe(true);
  });

  it("returns module keys and type names for an unknown query", () => {
    const ids = knownIds("no-such-thing");
    expect(ids).toEqual(expect.arrayContaining(["flow", "MoveEffect", "PlayerTarget"]));
    expect(ids).toEqual([...ids].sort());
  });

  it("does not index plain-union keywords: actor points at PlayerTarget via the unknown list", () => {
    expect(knownIds("actor")).toContain("PlayerTarget");
  });

  it("never resolves a derived union's variants", () => {
    expect(variantIds().filter((id) => id.startsWith("NamedEffect."))).toEqual([]);
    expect(text("NamedEffect")).toContain("Any `Effect` variant, plus:");
  });

  it("names only registered discriminated unions as primary", () => {
    const schemas = getRegistry().schemas;
    expect(PRIMARY_UNIONS.filter((name) => !schemas.has(name) || variantsOf(schemas.get(name)!) === undefined)).toEqual([]);
  });

  it("resolves every qualified variant id", () => {
    for (const id of variantIds()) expect(schemaDoc(id).ok).toBe(true);
  });

  it("leaves only these bare values ambiguous", () => {
    const byValue = new Map<string, string[]>();
    for (const id of variantIds()) {
      const value = id.slice(id.indexOf(".") + 1);
      byValue.set(value, [...(byValue.get(value) ?? []), id.slice(0, id.indexOf("."))]);
    }
    const ambiguous = [...byValue]
      .filter(([, unions]) => unions.length > 1 && unions.filter((union) => PRIMARY_UNIONS.includes(union)).length !== 1)
      .map(([value]) => value);
    expect(ambiguous).toEqual(["condition"]);
  });

  it("indexes every discriminated union in the spec tree, so none depends on being reached by name", () => {
    const registry = getRegistry();
    const visited = new Set<unknown>();
    const anonymous: string[] = [];
    const walk = (schema: z.ZodType, path: string, named: boolean): void => {
      named ||= registry.nameOf(schema) !== undefined;
      const def = (schema as unknown as { _zod: { def: Record<string, any> } })._zod.def;
      const branches = keyedBranchesOf(schema);
      if (branches !== undefined) {
        for (const [key, branch] of Object.entries(branches)) walk(branch, `${path}<${key}>`, false);
        return;
      }
      if (["optional", "nullable", "default", "readonly"].includes(def.type)) return walk(def.innerType, path, named);
      if (visited.has(def)) return;
      visited.add(def);
      // A lazy getter builds a new schema per call, so the lazy def itself guards the cycle.
      if (def.type === "lazy") return walk(def.getter(), path, named);
      if (def.type === "array") walk(def.element, `${path}[]`, false);
      else if (def.type === "record") walk(def.valueType, `${path}{}`, false);
      else if (def.type === "object") for (const [key, field] of Object.entries(def.shape)) walk(field as z.ZodType, `${path}.${key}`, false);
      else if (def.type === "union") {
        if (def.discriminator !== undefined && !named) anonymous.push(path);
        for (const option of def.options) walk(option, path, false);
      }
    };
    walk(ModularGameSpecSchema, "spec", false);
    expect(anonymous).toEqual([]);
  });

  describe("examples", () => {
    let dir: string;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "schema-ref-"));
      mkdirSync(join(dir, "examples"));
      writeFileSync(
        join(dir, "examples", "effects.md"),
        ["# Effects", "", "## Effect.move", "", "```yaml example", "effect: move", "```", "", "## Effect.flip", "", "flip text", ""].join("\n"),
      );
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    const examplesDir = () => pathToFileURL(join(dir, "examples") + "/");

    it("appends a variant's example section to its page", () => {
      const result = schemaDoc("move", { examplesDir: examplesDir() });
      expect(result.ok && result.text).toContain("\n## Effect.move\n\n```yaml example\neffect: move\n```\n");
      expect(result.ok && result.text).not.toContain("flip text");
    });

    it("appends nothing to a type-name page or a variant without a section", () => {
      const byName = schemaDoc("MoveEffect", { examplesDir: examplesDir() });
      expect(byName.ok && byName.text).not.toContain("## Effect.move");
      const noSection = schemaDoc("Effect.shuffle", { examplesDir: examplesDir() });
      expect(noSection.ok && noSection.text).toBe(text("Effect.shuffle"));
    });
  });
});
