import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import yaml from "js-yaml";
import { AuthoringCode } from "../diagnostics.js";
import { MANIFEST_FILE, SPEC_DIR } from "../project.js";
import { getVersions } from "../versions.js";

/** Package `templates/` directory; the same relative depth from `src/tools` and `dist/tools`. */
const TEMPLATES_DIR = new URL("../../templates/", import.meta.url);

/** Project-relative path of the gitignore that keeps `.chaincraft/` out of version control. */
const TRACE_GITIGNORE = ".chaincraft/.gitignore";

/** Options for {@link init}. */
export interface InitOptions {
  /** Manifest id; defaults to the sanitized directory name. */
  id?: string;
}

/** Outcome of {@link init}. */
export interface InitResult {
  /** Project-relative targets written; directories end in `/`. */
  created: string[];
}

/** Thrown by {@link init} when any target already exists; nothing is written in that case. */
export class InitConflictError extends Error {
  readonly code = AuthoringCode.InitConflict;

  /** @param conflicts - Project-relative targets that already exist. */
  constructor(readonly conflicts: string[]) {
    super(`Cannot init: already exists: ${conflicts.join(", ")}. Nothing was written.`);
    this.name = "InitConflictError";
  }
}

/** Derives a manifest id from the directory name: lowercased, non `[a-z0-9-]` replaced by `-`. */
function defaultId(dir: string): string {
  return basename(resolve(dir)).toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

/** Builds the empty `brief.md` with the required section headings. */
function briefSkeleton(id: string): string {
  const headings = ["Overview", "Shape", "Material", "Rules", "Cross-cutting", "Decisions", "Examples", "Open questions"];
  return `# ${id}\n\n${headings.map((h) => `## ${h}\n`).join("\n")}`;
}

/**
 * Scaffolds a new project in `dir`: manifest, `spec/`, brief, agent instructions and trace gitignore.
 *
 * @param dir - Target directory; must already exist.
 * @param options - See {@link InitOptions}.
 * @throws {InitConflictError} If any target already exists.
 */
export function init(dir: string, options: InitOptions = {}): InitResult {
  const targets = [MANIFEST_FILE, `${SPEC_DIR}/`, "brief.md", "AGENTS.md", "CLAUDE.md", TRACE_GITIGNORE];
  const conflicts = targets.filter((t) => existsSync(join(dir, t)));
  if (conflicts.length > 0) throw new InitConflictError(conflicts);

  const id = options.id ?? defaultId(dir);
  const versions = getVersions();
  const manifest = yaml.dump({ id, engine: { authoring: versions.authoring, runtime: versions.runtime } });

  mkdirSync(join(dir, SPEC_DIR), { recursive: true });
  mkdirSync(join(dir, ".chaincraft"), { recursive: true });
  writeFileSync(join(dir, MANIFEST_FILE), manifest);
  writeFileSync(join(dir, "brief.md"), briefSkeleton(id));
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    writeFileSync(join(dir, name), readFileSync(new URL(name, TEMPLATES_DIR)));
  }
  writeFileSync(join(dir, TRACE_GITIGNORE), "*\n");

  return { created: targets };
}
