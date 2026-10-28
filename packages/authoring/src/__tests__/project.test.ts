import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModularGameSpecSchema } from "@chaincraft/gamedef";
import { findProjectRoot, loadProject, ManifestError, readManifest } from "../project.js";
import { mapFile } from "../diagnostics.js";

const MANIFEST = "id: test-game\nengine:\n  authoring: 0.1.0\n  runtime: 0.1.0\n";

let dir: string;

function write(rel: string, content: string): void {
  const full = join(dir, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cc-project-"));
  write("chaincraft.yaml", MANIFEST);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadProject", () => {
  it("merges module keys from multiple files", () => {
    write("spec/flow.yaml", "flow:\n  root: { kind: loop }\n");
    write("spec/meta.yml", "metadata:\n  title: T\nplayers:\n  roles: []\n");

    const result = loadProject(dir);

    expect(result.diagnostics).toEqual([]);
    expect(Object.keys(result.spec).sort()).toEqual(["flow", "metadata", "players"]);
    expect(result.moduleFiles).toEqual({
      flow: "spec/flow.yaml",
      metadata: "spec/meta.yml",
      players: "spec/meta.yml",
    });
    expect(result.manifest.id).toBe("test-game");
  });

  it("loads a single-file spec", () => {
    write("spec/game.yaml", "metadata:\n  title: T\nflow:\n  root: {}\n");

    const result = loadProject(dir);

    expect(result.diagnostics).toEqual([]);
    expect(result.moduleFiles).toEqual({ metadata: "spec/game.yaml", flow: "spec/game.yaml" });
  });

  it("reports no-spec-files when spec/ is missing", () => {
    const result = loadProject(dir);

    expect(result.diagnostics.map((d) => d.code)).toEqual(["no-spec-files"]);
  });

  it("reports no-spec-files when spec/ has no YAML", () => {
    write("spec/notes.txt", "hello");

    expect(loadProject(dir).diagnostics.map((d) => d.code)).toEqual(["no-spec-files"]);
  });

  it("reports yaml-syntax with file and 1-based line", () => {
    write("spec/bad.yaml", "metadata:\n  title: T\nflow: [unclosed\n");

    const result = loadProject(dir);

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      severity: "error",
      code: "yaml-syntax",
      file: "spec/bad.yaml",
    });
    expect(result.diagnostics[0].line).toBeGreaterThanOrEqual(1);
  });

  it("reports not-a-mapping for a list or scalar top level", () => {
    write("spec/list.yaml", "- a\n- b\n");
    write("spec/scalar.yaml", "just text\n");

    const result = loadProject(dir);

    expect(result.diagnostics.map((d) => [d.code, d.file])).toEqual([
      ["not-a-mapping", "spec/list.yaml"],
      ["not-a-mapping", "spec/scalar.yaml"],
    ]);
  });

  it("skips empty files silently", () => {
    write("spec/empty.yaml", "");
    write("spec/comments.yaml", "# nothing here\n");
    write("spec/flow.yaml", "flow: {}\n");

    const result = loadProject(dir);

    expect(result.diagnostics).toEqual([]);
    expect(Object.keys(result.spec)).toEqual(["flow"]);
  });

  it("reports unknown-module with the known module keys and does not merge it", () => {
    write("spec/typo.yaml", "effect:\n  effects: []\n");

    const result = loadProject(dir);

    expect(result.spec).toEqual({});
    expect(result.diagnostics).toEqual([
      {
        severity: "error",
        code: "unknown-module",
        message: expect.stringContaining("effect"),
        file: "spec/typo.yaml",
        path: "effect",
        knownIds: Object.keys(ModularGameSpecSchema.shape).sort(),
      },
    ]);
  });

  it("reports duplicate-module naming both files and keeps the first", () => {
    write("spec/a.yaml", "flow:\n  root: { kind: a }\n");
    write("spec/b.yaml", "flow:\n  root: { kind: b }\n");

    const result = loadProject(dir);

    expect(result.spec).toEqual({ flow: { root: { kind: "a" } } });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe("duplicate-module");
    expect(result.diagnostics[0].message).toContain("spec/a.yaml");
    expect(result.diagnostics[0].message).toContain("spec/b.yaml");
  });

  it("does not follow symlinks out of spec/", () => {
    const outside = mkdtempSync(join(tmpdir(), "cc-outside-"));
    try {
      writeFileSync(join(outside, "flow.yaml"), "flow: {}\n");
      mkdirSync(join(dir, "spec"));
      symlinkSync(join(outside, "flow.yaml"), join(dir, "spec", "flow.yaml"));

      expect(loadProject(dir).diagnostics.map((d) => d.code)).toEqual(["no-spec-files"]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("readManifest", () => {
  it("throws ManifestError for an invalid manifest", () => {
    write("chaincraft.yaml", "engine: {}\n");

    expect(() => readManifest(dir)).toThrow(ManifestError);
  });
});

describe("findProjectRoot", () => {
  it("finds the root from a nested directory", () => {
    write("spec/nested/deep/.keep", "");

    expect(findProjectRoot(join(dir, "spec", "nested", "deep"))).toBe(dir);
  });

  it("returns undefined when no manifest exists above", () => {
    const bare = mkdtempSync(join(tmpdir(), "cc-bare-"));
    try {
      expect(findProjectRoot(bare)).toBeUndefined();
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe("mapFile", () => {
  it("maps the first path segment to its file", () => {
    const files = { actions: "spec/actions.yaml", mechanics: "spec/m.yaml" };

    expect(mapFile("actions.actions[0].steps[1].effectRef", files)).toBe("spec/actions.yaml");
    expect(mapFile("mechanics[0].id", files)).toBe("spec/m.yaml");
    expect(mapFile("flow.root", files)).toBeUndefined();
  });
});
