// Shared by corpus.test.ts and scripts/record-corpus.ts. Pure: never writes files.
import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { join, relative, dirname, sep } from "path";
import { fileURLToPath } from "url";
import { load } from "js-yaml";
import { ModularGameSpecSchema } from "#gamedef/index.js";
import { validate, schemaIssues } from "#gamedef/validator/index.js";

const here = dirname(fileURLToPath(import.meta.url));

export const PACKAGE_ROOT = join(here, "../..");
export const EXAMPLES_DIR = join(PACKAGE_ROOT, "examples");
export const CORPUS_DIR = here;
export const SPECS_DIR = join(CORPUS_DIR, "specs");
export const INVALID_DIR = join(CORPUS_DIR, "invalid");
export const GOLDEN_DIR = join(CORPUS_DIR, "golden");

export interface CorpusInput {
  kind: "valid" | "invalid";
  /** Absolute path of the source YAML. */
  file: string;
  /** Golden path relative to GOLDEN_DIR, e.g. "examples/high-card.json". */
  goldenRel: string;
}

export interface ExcludedFile {
  file: string;
  reason: string;
}

export type Golden =
  | { valid: true; spec: unknown }
  | { valid: false; issues: { path: string; code: string }[] };

function walkYaml(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkYaml(full));
    else if (/\.ya?ml$/.test(name)) out.push(full);
  }
  return out;
}

function goldenRelFor(prefix: string, base: string, file: string): string {
  const rel = relative(base, file).split(sep).join("/").replace(/\.ya?ml$/, "");
  return `${prefix}/${rel}.json`;
}

export function readYaml(file: string): unknown {
  return load(readFileSync(file, "utf-8"));
}

function isCompleteSpec(raw: unknown): boolean {
  return (
    raw !== null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    "metadata" in (raw as Record<string, unknown>)
  );
}

export function discoverInputs(): { inputs: CorpusInput[]; excluded: ExcludedFile[] } {
  const inputs: CorpusInput[] = [];
  const excluded: ExcludedFile[] = [];

  const sources: [string, string][] = [
    ["examples", EXAMPLES_DIR],
    ["specs", SPECS_DIR],
  ];
  for (const [prefix, base] of sources) {
    for (const file of walkYaml(base)) {
      const raw = readYaml(file);
      if (!isCompleteSpec(raw)) {
        excluded.push({ file, reason: "no top-level `metadata` key (not a complete spec)" });
      } else if (!validate(raw).valid) {
        excluded.push({ file, reason: "fails validate() today" });
      } else {
        inputs.push({ kind: "valid", file, goldenRel: goldenRelFor(prefix, base, file) });
      }
    }
  }
  for (const file of walkYaml(INVALID_DIR)) {
    inputs.push({ kind: "invalid", file, goldenRel: goldenRelFor("invalid", INVALID_DIR, file) });
  }
  return { inputs, excluded };
}

export function computeGolden(input: CorpusInput): Golden {
  const raw = readYaml(input.file);
  if (input.kind === "valid") {
    const result = validate(raw);
    if (!result.valid) {
      throw new Error(
        `${input.file} is in the valid corpus but fails validation: ${JSON.stringify(result.errors)}`,
      );
    }
    return { valid: true, spec: result.spec };
  }
  const parsed = ModularGameSpecSchema.safeParse(raw);
  if (parsed.success) {
    throw new Error(`${input.file} is an invalid fixture but parses successfully`);
  }
  return {
    valid: false,
    issues: schemaIssues(parsed.error).map((i) => ({ path: i.path.join("."), code: i.code })),
  };
}

export function serializeGolden(golden: Golden): string {
  return JSON.stringify(golden, null, 2) + "\n";
}

export function listGoldenFiles(): string[] {
  return walkJson(GOLDEN_DIR).map((f) => relative(GOLDEN_DIR, f).split(sep).join("/"));
}

function walkJson(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkJson(full));
    else if (name.endsWith(".json")) out.push(full);
  }
  return out;
}
