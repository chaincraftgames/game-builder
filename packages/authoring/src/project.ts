import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, parse as parsePath } from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { ModularGameSpecSchema } from "@chaincraft/gamedef";
import { AuthoringCode, type Diagnostic } from "./diagnostics.js";

/** Project manifest file name, located at the project root. */
export const MANIFEST_FILE = "chaincraft.yaml";

/** Project-relative directory holding the spec YAML files. */
export const SPEC_DIR = "spec";

/** Shape of `chaincraft.yaml`. */
const ManifestSchema = z.object({
  /** Used as the `specId` passed to `assembleModule`. */
  id: z.string().min(1),
  /** Engine versions the project was created against. */
  engine: z.object({
    authoring: z.string(),
    runtime: z.string(),
  }),
});

/** Parsed `chaincraft.yaml`. */
export type Manifest = z.infer<typeof ManifestSchema>;

/** Thrown when `chaincraft.yaml` is unreadable or fails schema validation. */
export class ManifestError extends Error {
  /** @param message - Description of what is wrong with the manifest. */
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

/** Result of {@link loadProject}. */
export interface LoadedProject {
  manifest: Manifest;
  /** Merged module keys from all spec files, ready for gamedef validation. */
  spec: Record<string, unknown>;
  /** Module key -> project-relative file, e.g. "actions" -> "spec/actions.yaml" */
  moduleFiles: Record<string, string>;
  /** Loader errors (syntax, unknown or duplicate modules, no files). */
  diagnostics: Diagnostic[];
}

/**
 * Walks up from `cwd` to the nearest directory containing `chaincraft.yaml`.
 *
 * @returns The project root, or `undefined` if there is none.
 */
export function findProjectRoot(cwd: string): string | undefined {
  let dir = cwd;
  const { root } = parsePath(dir);
  for (;;) {
    if (existsSync(join(dir, MANIFEST_FILE))) return dir;
    if (dir === root) return undefined;
    dir = dirname(dir);
  }
}

/**
 * Reads and validates `chaincraft.yaml` in `root`.
 *
 * @throws {ManifestError} If the file cannot be read or is invalid.
 */
export function readManifest(root: string): Manifest {
  let raw: unknown;
  try {
    raw = yaml.load(readFileSync(join(root, MANIFEST_FILE), "utf8"));
  } catch (err) {
    throw new ManifestError(`Cannot read ${MANIFEST_FILE}: ${(err as Error).message}`);
  }
  const result = ManifestSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new ManifestError(`Invalid ${MANIFEST_FILE}: ${issues.join("; ")}`);
  }
  return result.data;
}

/** Lists `spec/*.yaml` and `spec/*.yml` file names, sorted; empty if `spec/` is missing. */
function listSpecFiles(root: string): string[] {
  const dir = join(root, SPEC_DIR);
  if (!existsSync(dir)) return [];
  // Dirent.isFile() is false for symlinks, so nothing outside spec/ is followed.
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.ya?ml$/i.test(e.name))
    .map((e) => e.name)
    .sort();
}

/** Type guard for a plain object (not null, not an array). */
function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the manifest and merges every top-level module key from `spec/*.yaml` into one spec.
 * Problems with individual files are returned as diagnostics rather than thrown.
 *
 * @throws {ManifestError} If `chaincraft.yaml` is unreadable or invalid.
 */
export function loadProject(root: string): LoadedProject {
  const manifest = readManifest(root);
  const spec: Record<string, unknown> = {};
  const moduleFiles: Record<string, string> = {};
  const diagnostics: Diagnostic[] = [];
  const knownModules = Object.keys(ModularGameSpecSchema.shape);

  const files = listSpecFiles(root);
  if (files.length === 0) {
    diagnostics.push({
      severity: "error",
      code: AuthoringCode.NoSpecFiles,
      message: `No YAML files found in ${SPEC_DIR}/. Add at least one ${SPEC_DIR}/*.yaml file.`,
    });
    return { manifest, spec, moduleFiles, diagnostics };
  }

  for (const name of files) {
    const file = `${SPEC_DIR}/${name}`;
    let parsed: unknown;
    try {
      parsed = yaml.load(readFileSync(join(root, SPEC_DIR, name), "utf8"));
    } catch (err) {
      const e = err as yaml.YAMLException;
      diagnostics.push({
        severity: "error",
        code: AuthoringCode.YamlSyntax,
        message: `YAML syntax error: ${e.reason ?? e.message}`,
        file,
        line: e.mark ? e.mark.line + 1 : undefined,
      });
      continue;
    }

    if (parsed === undefined || parsed === null) continue;
    if (!isMapping(parsed)) {
      diagnostics.push({
        severity: "error",
        code: AuthoringCode.NotAMapping,
        message: `Top level of ${file} must be a mapping of module keys (e.g. "flow:", "actions:").`,
        file,
      });
      continue;
    }

    for (const [key, value] of Object.entries(parsed)) {
      if (!knownModules.includes(key)) {
        diagnostics.push({
          severity: "error",
          code: AuthoringCode.UnknownModule,
          message: `Unknown module "${key}" in ${file}.`,
          file,
          path: key,
          knownIds: [...knownModules].sort(),
        });
        continue;
      }
      if (Object.hasOwn(moduleFiles, key)) {
        diagnostics.push({
          severity: "error",
          code: AuthoringCode.DuplicateModule,
          message: `Module "${key}" is defined in both ${moduleFiles[key]} and ${file}.`,
          file,
          path: key,
        });
        continue;
      }
      spec[key] = value;
      moduleFiles[key] = file;
    }
  }

  return { manifest, spec, moduleFiles, diagnostics };
}
