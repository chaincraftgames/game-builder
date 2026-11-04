import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

// Prerequisite: `npm run build -w @chaincraft/authoring` (these tests run the built CLI).
const CLI = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
const EXAMPLE = fileURLToPath(new URL("../../../gamedef/examples/high-card.yaml", import.meta.url));

let dir: string;

function cc(args: string[], cwd: string = dir) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function writeSpec(mutate?: (spec: Record<string, Record<string, unknown>>) => void): void {
  const spec = yaml.load(readFileSync(EXAMPLE, "utf8")) as Record<string, Record<string, unknown>>;
  mutate?.(spec);
  writeFileSync(join(dir, "spec", "high-card.yaml"), yaml.dump(spec));
}

function logLines(): Array<Record<string, unknown>> {
  return readFileSync(join(dir, ".chaincraft", "log.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cc-cli-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("usage", () => {
  it("--version prints the header and exits 0", () => {
    const r = cc(["--version"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^chaincraft \S+ \(runtime \S+\)\n/);
  });

  it("help exits 0", () => {
    const r = cc(["help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Usage: chaincraft");
  });

  it.each([[[]], [["bogus"]], [["validate", "--bogus"]], [["compile", "--draft"]], [["validate", "extra"]]])(
    "%j exits 2",
    (args) => {
      expect(cc(args as string[]).status).toBe(2);
    },
  );

  it("outside a project, validate exits 1 with guidance", () => {
    const r = cc(["validate"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Not a ChainCraft project");
  });

  it("logs usage errors when run inside a project", () => {
    expect(cc(["init"]).status).toBe(0);
    expect(cc(["bogus"]).status).toBe(2);
    const last = logLines().at(-1)!;
    expect(last).toMatchObject({ command: "bogus", exitCode: 2 });
  });
});

describe("init", () => {
  it("creates the project; a second init exits 1 with init-conflict", () => {
    expect(cc(["init"]).status).toBe(0);
    const r = cc(["init", "--json"]);
    expect(r.status).toBe(1);
    const out = JSON.parse(r.stdout);
    expect(out.ok).toBe(false);
    expect(out.diagnostics[0].code).toBe("init-conflict");
  });

  it("does not create .chaincraft/ when init fails in a non-project directory", () => {
    mkdirSync(join(dir, "spec"));
    expect(cc(["init"]).status).toBe(1);
    expect(() => readFileSync(join(dir, ".chaincraft", "log.jsonl"))).toThrow();
  });
});

describe("docs", () => {
  it.each([[[]], [["schema"]], [["schema", "flow"]], [["expressions"]], [["example"]], [["example", "flow"]]])(
    "docs %j exits 0 with output, outside a project",
    (args) => {
      const r = cc(["docs", ...(args as string[])]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/^chaincraft \S+ \(runtime \S+\)\n\n\S/);
      expect(r.stdout.length).toBeGreaterThan(200);
      expect(() => readFileSync(join(dir, ".chaincraft", "log.jsonl"))).toThrow();
    },
  );

  it("an unknown topic exits 1 and lists known ids", () => {
    const r = cc(["docs", "bogus"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("unknown-topic");
    expect(r.stdout).toContain("known ids: ");
    expect(r.stdout).toContain("schema");
  });

  it("lists every known id for an unknown schema query, without truncation", () => {
    const r = cc(["docs", "schema", "nope", "--json"]);
    const ids: string[] = JSON.parse(r.stdout).diagnostics[0].knownIds;
    expect(ids.length).toBeGreaterThan(30);
    const text = cc(["docs", "schema", "nope"]).stdout;
    expect(text).not.toContain("more)");
    expect(text).toContain(ids.at(-1)!);
  });

  it("rejects a third argument", () => {
    expect(cc(["docs", "schema", "flow", "extra"]).status).toBe(2);
  });

  it("a no-argument topic given an argument is unknown-topic without topic ids", () => {
    const r = cc(["docs", "expressions", "x", "--json"]);
    expect(r.status).toBe(1);
    const [diagnostic] = JSON.parse(r.stdout).diagnostics;
    expect(diagnostic.code).toBe("unknown-topic");
    expect(diagnostic.message).toContain("takes no argument");
    expect(diagnostic.knownIds).toBeUndefined();
    expect(cc(["docs", "expressions", "x"]).stdout).not.toContain("known ids");
  });

  it("inside a project, appends a log line with the args", () => {
    expect(cc(["init"]).status).toBe(0);
    expect(cc(["docs", "schema", "flow"]).status).toBe(0);
    expect(cc(["docs", "bogus"]).status).toBe(1);
    const lines = logLines();
    expect(lines.at(-2)).toMatchObject({ command: "docs", args: ["docs", "schema", "flow"], exitCode: 0 });
    expect(lines.at(-1)).toMatchObject({ command: "docs", args: ["docs", "bogus"], exitCode: 1 });
  });

  it("--json has the documented shape", () => {
    const ok = JSON.parse(cc(["docs", "expressions", "--json"]).stdout);
    expect(ok).toMatchObject({ command: "docs", ok: true, diagnostics: [] });
    expect(ok.text).toContain("Condition expressions");
    expect(ok.versions.authoring).toEqual(expect.any(String));
    const bad = JSON.parse(cc(["docs", "bogus", "--json"]).stdout);
    expect(bad).toMatchObject({ command: "docs", ok: false });
    expect(bad.diagnostics[0].code).toBe("unknown-topic");
  });
});

describe("validate / compile", () => {
  beforeEach(() => {
    cc(["init"]);
  });

  it("points at the schema page after a schema error", () => {
    writeSpec((spec) => {
      (spec.flow as Record<string, unknown>).bogusKey = 1;
    });
    const r = cc(["validate"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("schema");
    expect(r.stdout).toMatch(/\n\nsee `chaincraft docs schema flow`$/m);
  });

  it("points at the bare schema index for an unknown module", () => {
    writeFileSync(join(dir, "spec", "typo.yaml"), "fow: {}\n");
    const r = cc(["validate"]);
    expect(r.stdout).toContain("unknown-module");
    expect(r.stdout).toMatch(/\n\nsee `chaincraft docs schema`$/m);
  });

  it.each([["schema flow"], ["schema"]])("the pointer `docs %s` exits 0", (args) => {
    expect(cc(["docs", ...args.split(" ")]).status).toBe(0);
  });

  it("prints no schema pointer for other errors", () => {
    expect(cc(["validate"]).stdout).not.toContain("see `chaincraft docs");
  });

  it("empty spec/ exits 1 with no-spec-files", () => {
    const r = cc(["validate"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("no-spec-files");
    expect(r.stdout).toMatch(/1 error, 0 todos/);
  });

  it("valid spec exits 0 and compile prints a summary", () => {
    writeSpec();
    expect(cc(["validate"]).status).toBe(0);
    const r = cc(["compile"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/OK \(\d+ actions, \d+ effects, \d+ flow nodes\)/);
  });

  it("unresolved ref: strict exits 1 with known ids, --draft exits 0 with a todo", () => {
    writeSpec((spec) => {
      (spec.actions.actions as Array<{ steps: unknown[] }>)[0].steps.push({ effectRef: "dela" });
    });
    const strict = cc(["validate"]);
    expect(strict.status).toBe(1);
    expect(strict.stdout).toContain("unresolved-ref");
    expect(strict.stdout).toContain("known ids:");

    const draft = cc(["validate", "--draft"]);
    expect(draft.status).toBe(0);
    expect(draft.stdout).toContain("todo unresolved-ref");
    expect(draft.stdout).toMatch(/0 errors, 1 todo/);
  });

  it("--json has the documented shape", () => {
    writeSpec();
    const r = cc(["compile", "--json"]);
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({ command: "compile", ok: true, diagnostics: [] });
    expect(out.versions).toEqual(
      expect.objectContaining({ authoring: expect.any(String), gamedef: expect.any(String), compiler: expect.any(String), runtime: expect.any(String) }),
    );
    expect(out.summary.actions).toBeGreaterThan(0);
  });

  it("finds the project root from a nested directory", () => {
    writeSpec();
    expect(cc(["validate"], join(dir, "spec")).status).toBe(0);
  });

  it("warns on stderr when the manifest pins a different engine version", () => {
    writeSpec();
    writeFileSync(join(dir, "chaincraft.yaml"), "id: x\nengine:\n  authoring: 9.9.9\n  runtime: 9.9.9\n");
    const r = cc(["validate"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("pins authoring 9.9.9");
  });

  it("reports an invalid manifest as a diagnostic", () => {
    writeFileSync(join(dir, "chaincraft.yaml"), "id: x\n");
    const r = cc(["validate", "--json"]);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).diagnostics[0]).toMatchObject({ code: "invalid-manifest", file: "chaincraft.yaml" });
  });

  it("appends one log line per call", () => {
    writeSpec();
    cc(["validate"]);
    cc(["validate", "--draft"]);
    cc(["compile"]);
    const lines = logLines();
    expect(lines.map((l) => l.command)).toEqual(["init", "validate", "validate", "compile"]);
    expect(lines[2].args).toEqual(["validate", "--draft"]);
    expect(lines[3]).toMatchObject({ exitCode: 0, counts: { errors: 0, todos: 0 } });
    expect(typeof lines[3].durationMs).toBe("number");
  });
});
