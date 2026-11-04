import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { docs } from "../tools/docs.js";

let dir: string;
const docsDir = () => pathToFileURL(`${dir}/`);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cc-docs-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("topic availability", () => {
  it("lists only topics whose content exists", () => {
    const text = docs(undefined, undefined, { docsDir: docsDir() }).text!;
    expect(text).toContain("`schema`");
    expect(text).toContain("`expressions`");
    for (const absent of ["guide", "howto", "known-gaps", "example"]) expect(text).not.toContain(`\`${absent}\``);
  });

  it.each(["guide", "howto", "known-gaps", "example"])("%s is unknown-topic when its content is absent", (topic) => {
    const result = docs(topic, undefined, { docsDir: docsDir() });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({ code: "unknown-topic" });
    expect(result.diagnostics[0].knownIds).toEqual(["schema", "expressions"]);
  });

  it("the shipped docs list schema, expressions and example", () => {
    const text = docs().text!;
    for (const topic of ["schema", "expressions", "example"]) expect(text).toContain(`\`${topic}\``);
  });
});

describe("content present", () => {
  beforeEach(() => {
    writeFileSync(join(dir, "guide.md"), "# Guide\n\n## Game end\n\nBoth an end condition and win conditions are required.\n\n## Lifecycle\n\nSetup lives in root onEnter.\n");
    writeFileSync(join(dir, "known-gaps.md"), "# Known gaps\n\n## capacity\n\nNot enforced.\n");
    mkdirSync(join(dir, "howto"));
    writeFileSync(join(dir, "howto", "a.md"), "---\nid: a\ntitle: Do A\ntouches: [flow, effects]\n---\n**When:** always.\n");
    writeFileSync(join(dir, "howto", "b.md"), "---\nid: b\ntitle: Do B\ntouches: [state]\n---\n**When:** never.\n");
    mkdirSync(join(dir, "examples"));
    writeFileSync(join(dir, "examples", "high-card.yaml"), "metadata:\n  name: X\nflow:\n  root: {}\n");
  });

  it("guide: index lists section ids, an id returns that section only", () => {
    const index = docs("guide", undefined, { docsDir: docsDir() }).text!;
    expect(index).toContain("`game-end`");
    expect(index).toContain("`lifecycle`");
    const section = docs("guide", "lifecycle", { docsDir: docsDir() }).text!;
    expect(section).toContain("Setup lives in root onEnter.");
    expect(section).not.toContain("end condition");
    expect(docs("guide", "nope", { docsDir: docsDir() }).diagnostics[0].knownIds).toEqual(["game-end", "lifecycle"]);
  });

  it("howto: index shows id, title and touches; an id returns the recipe", () => {
    const index = docs("howto", undefined, { docsDir: docsDir() }).text!;
    expect(index).toContain("| `a` | Do A | `flow`, `effects` |");
    expect(docs("howto", "b", { docsDir: docsDir() }).text).toContain("**When:** never.");
    expect(docs("howto", "c", { docsDir: docsDir() }).diagnostics[0].knownIds).toEqual(["a", "b"]);
  });

  it("known-gaps returns the file and takes no argument", () => {
    expect(docs("known-gaps", undefined, { docsDir: docsDir() }).text).toContain("Not enforced.");
    expect(docs("known-gaps", "x", { docsDir: docsDir() }).ok).toBe(false);
  });

  it("example returns the whole spec or one module", () => {
    expect(docs("example", undefined, { docsDir: docsDir() }).text).toContain("metadata:");
    const flow = docs("example", "flow", { docsDir: docsDir() }).text!;
    expect(flow).toContain("flow:");
    expect(flow).not.toContain("metadata");
    expect(docs("example", "nope", { docsDir: docsDir() }).diagnostics[0].knownIds).toEqual(["metadata", "flow"]);
  });
});

describe("schema", () => {
  it("resolves a module key", () => {
    expect(docs("schema", "flow").ok).toBe(true);
  });

  it("an unknown query is unknown-topic with known ids", () => {
    const result = docs("schema", "nope");
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].knownIds).toEqual(expect.arrayContaining(["flow", "MoveEffect"]));
  });

  it("an unknown topic lists the available topics", () => {
    const result = docs("bogus");
    expect(result.diagnostics[0]).toMatchObject({ code: "unknown-topic" });
    expect(result.diagnostics[0].knownIds).toEqual(expect.arrayContaining(["schema", "expressions"]));
  });
});
