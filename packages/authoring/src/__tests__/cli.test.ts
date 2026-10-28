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

describe("validate / compile", () => {
  beforeEach(() => {
    cc(["init"]);
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
