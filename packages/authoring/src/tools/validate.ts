import { validate as validateSpec } from "@chaincraft/gamedef/validator";
import type { ModularGameSpec } from "@chaincraft/gamedef";
import {
  AuthoringCode,
  DRAFT_TODO_CODES,
  mapFile,
  type Diagnostic,
} from "../diagnostics.js";
import { loadProject } from "../project.js";

/** Modules whose absence makes `assembleModule` throw (`assembleConfig` needs metadata, `assembleFlow` needs flow). */
export const REQUIRED_MODULES = ["metadata", "flow"] as const;

/** Options for {@link validate}. */
export interface ValidateOptions {
  /** Downgrade unresolved references and missing modules from errors to todos. */
  draft?: boolean;
}

/** Outcome of {@link validate}. */
export interface ValidateResult {
  /** True when no diagnostic has severity `error`. */
  ok: boolean;
  diagnostics: Diagnostic[];
  /** The parsed spec; only present when gamedef validation passed cleanly. */
  spec?: ModularGameSpec;
}

/**
 * Loads the project at `root` and runs schema, gamedef and required-module checks.
 * Loader errors short-circuit before gamedef runs.
 *
 * @param root - Project root containing `chaincraft.yaml`.
 * @param options - See {@link ValidateOptions}.
 */
export function validate(
  root: string,
  options: ValidateOptions = {},
): ValidateResult {
  const project = loadProject(root);
  if (project.diagnostics.length > 0) {
    return { ok: false, diagnostics: project.diagnostics };
  }

  const result = validateSpec(project.spec);
  const diagnostics: Diagnostic[] = result.errors.map((e) => ({
    severity: "error",
    code: e.code,
    message: e.message,
    file: mapFile(e.path, project.moduleFiles),
    path: e.path,
    ...(e.knownIds ? { knownIds: e.knownIds } : {}),
  }));

  for (const key of REQUIRED_MODULES) {
    if (Object.hasOwn(project.spec, key)) continue;
    diagnostics.push({
      severity: "error",
      code: AuthoringCode.MissingModule,
      message: `Required module "${key}" is missing. Add a top-level "${key}:" key to a file in spec/.`,
      path: key,
    });
  }

  if (options.draft) {
    for (const d of diagnostics) {
      if (DRAFT_TODO_CODES.has(d.code)) d.severity = "todo";
    }
  }

  const ok = diagnostics.every((d) => d.severity !== "error");
  return { ok, diagnostics, ...(result.spec ? { spec: result.spec } : {}) };
}
