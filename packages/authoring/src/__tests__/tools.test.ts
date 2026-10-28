import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { compile } from "../tools/compile.js";
import { init, InitConflictError } from "../tools/init.js";
import { validate } from "../tools/validate.js";
import { getVersions } from "../versions.js";

const EXAMPLES_DIR = fileURLToPath(new URL("../../../gamedef/examples/", import.meta.url));

let dir: string;

type Spec = Record<string, Record<string, unknown>>;

function splitExample(name: string, mutate?: (spec: Spec) => void): void {
  const spec = yaml.load(readFileSync(join(EXAMPLES_DIR, `${name}.yaml`), "utf8")) as Spec;
  mutate?.(spec);
  mkdirSync(join(dir, "spec"), { recursive: true });
  writeFileSync(join(dir, "chaincraft.yaml"), `id: ${name}\nengine:\n  authoring: 0.1.0\n  runtime: 0.1.0\n`);
  for (const [key, value] of Object.entries(spec)) {
    writeFileSync(join(dir, "spec", `${key}.yaml`), yaml.dump({ [key]: value }));
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cc-tools-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe.each(["high-card", "liars-dice"])("%s example", (name) => {
  it("validates", () => {
    splitExample(name);
    const result = validate(dir);
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.spec).toBeDefined();
  });

  it("compiles with a non-empty summary", () => {
    splitExample(name);
    const result = compile(dir);
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.summary!.actions).toBeGreaterThan(0);
    expect(result.summary!.effectDefs).toBeGreaterThan(0);
    expect(result.summary!.flowNodes).toBeGreaterThan(0);
  });
});

describe("validate", () => {
  const breakActionRef = (spec: Spec) => {
    (spec.actions.actions as Array<{ steps: unknown[] }>)[0].steps.push({ effectRef: "dela" });
  };

  it("reports unresolved-ref with file and knownIds in strict mode", () => {
    splitExample("high-card", breakActionRef);
    const result = validate(dir);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      severity: "error",
      code: "unresolved-ref",
      file: "spec/actions.yaml",
    });
    expect(result.diagnostics[0].knownIds).toContain("dealCards");
  });

  it("downgrades unresolved-ref to a todo in draft mode", () => {
    splitExample("high-card", breakActionRef);
    const result = validate(dir, { draft: true });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ severity: "todo", code: "unresolved-ref", file: "spec/actions.yaml" });
  });

  it("keeps non-todo codes as errors in draft mode", () => {
    splitExample("high-card", (spec) => {
      (spec.effects.effects as Array<{ id: string }>).push({ id: "dealCards" });
    });
    const result = validate(dir, { draft: true });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.every((d) => d.severity === "error")).toBe(true);
  });

  it("reports a missing required module as an error, and as a todo in draft", () => {
    splitExample("high-card");
    rmSync(join(dir, "spec", "flow.yaml"));

    const strict = validate(dir);
    expect(strict.ok).toBe(false);
    expect(strict.diagnostics).toEqual([expect.objectContaining({ severity: "error", code: "missing-module", path: "flow" })]);

    const draft = validate(dir, { draft: true });
    expect(draft.ok).toBe(true);
    expect(draft.diagnostics).toEqual([expect.objectContaining({ severity: "todo", code: "missing-module" })]);
  });

  it("returns loader errors without running gamedef", () => {
    splitExample("high-card");
    writeFileSync(join(dir, "spec", "bad.yaml"), "effect:\n  effects: []\n");
    const result = validate(dir);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["unknown-module"]);
  });
});

describe("compile", () => {
  it("reports a flow hook ref that passes gamedef but fails the compiler", () => {
    splitExample("high-card", (spec) => {
      (spec.effects.effects as Array<{ id: string }>).find((e) => e.id === "fillDeck")!.id = "fillDecc";
    });
    expect(validate(dir).ok).toBe(true);

    const result = compile(dir);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ severity: "error", code: "unresolved-ref", message: expect.stringContaining("fillDeck") }),
    ]);
    expect(result.diagnostics[0].knownIds).toContain("fillDecc");
  });

  it("stops at validation errors without assembling", () => {
    splitExample("high-card");
    rmSync(join(dir, "spec", "flow.yaml"));
    const result = compile(dir);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["missing-module"]);
    expect(result.summary).toBeUndefined();
  });
});

describe("init", () => {
  const TARGETS = ["chaincraft.yaml", "spec/", "brief.md", "AGENTS.md", "CLAUDE.md", ".chaincraft/.gitignore"];

  it("creates exactly the target list", () => {
    const projectDir = join(dir, "My Game");
    mkdirSync(projectDir);
    const result = init(projectDir);

    expect(result.created).toEqual(TARGETS);
    expect(readdirSync(projectDir).sort()).toEqual([".chaincraft", "AGENTS.md", "CLAUDE.md", "brief.md", "chaincraft.yaml", "spec"]);
    expect(readdirSync(join(projectDir, "spec"))).toEqual([]);
    expect(readFileSync(join(projectDir, ".chaincraft", ".gitignore"), "utf8")).toBe("*\n");

    const manifest = yaml.load(readFileSync(join(projectDir, "chaincraft.yaml"), "utf8"));
    const versions = getVersions();
    expect(manifest).toEqual({ id: "my-game", engine: { authoring: versions.authoring, runtime: versions.runtime } });

    const brief = readFileSync(join(projectDir, "brief.md"), "utf8");
    expect(brief.startsWith("# my-game\n\n## Overview\n\n## Shape\n")).toBe(true);
    expect(brief).toContain("## Open questions\n");
    expect(readFileSync(join(projectDir, "AGENTS.md"), "utf8").length).toBeGreaterThan(0);
  });

  it("honors an explicit id", () => {
    init(dir, { id: "custom-id" });
    expect(readFileSync(join(dir, "chaincraft.yaml"), "utf8")).toContain("id: custom-id");
  });

  it("fails with init-conflict and writes nothing when a target exists", () => {
    writeFileSync(join(dir, "brief.md"), "mine");
    writeFileSync(join(dir, "AGENTS.md"), "mine");

    let error: unknown;
    try {
      init(dir);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(InitConflictError);
    expect((error as InitConflictError).code).toBe("init-conflict");
    expect((error as InitConflictError).conflicts).toEqual(["brief.md", "AGENTS.md"]);
    expect(readdirSync(dir).sort()).toEqual(["AGENTS.md", "brief.md"]);
    expect(readFileSync(join(dir, "brief.md"), "utf8")).toBe("mine");
    expect(existsSync(join(dir, "chaincraft.yaml"))).toBe(false);
  });

  it("produces a project that loads", () => {
    init(dir);
    const result = validate(dir);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["no-spec-files"]);
  });
});
