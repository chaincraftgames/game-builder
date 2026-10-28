import type { CompileCode } from "@chaincraft/compiler";
import { ValidationCode } from "@chaincraft/gamedef/validator";

/** Machine-facing error classes originating in this package. */
export const AuthoringCode = {
  NoSpecFiles: "no-spec-files",
  YamlSyntax: "yaml-syntax",
  NotAMapping: "not-a-mapping",
  UnknownModule: "unknown-module",
  DuplicateModule: "duplicate-module",
  MissingModule: "missing-module",
  Expression: "expression",
  Internal: "internal",
  InitConflict: "init-conflict",
  InvalidManifest: "invalid-manifest",
} as const;

export type AuthoringCode = (typeof AuthoringCode)[keyof typeof AuthoringCode];

/** Any code a {@link Diagnostic} can carry, across gamedef, compiler and authoring. */
export type DiagnosticCode = ValidationCode | CompileCode | AuthoringCode;

/** Codes that draft mode downgrades to `todo`. */
export const DRAFT_TODO_CODES: ReadonlySet<DiagnosticCode> = new Set<DiagnosticCode>([
  ValidationCode.UnresolvedRef,
  AuthoringCode.MissingModule,
]);

/** `error` fails a command; `todo` is a draft-mode placeholder that does not. */
export type Severity = "error" | "todo";

/** A single problem reported to the user or agent. */
export interface Diagnostic {
  severity: Severity;
  code: DiagnosticCode;
  /** Agent-facing description. */
  message: string;
  /** Project-relative, e.g. "spec/actions.yaml" */
  file?: string;
  /** Spec dot-path, e.g. "actions.actions[0].steps[1].effectRef" */
  path?: string;
  /** Only set for yaml-syntax errors */
  line?: number;
  /** Ids that would have resolved; present on unresolved-ref style errors. */
  knownIds?: string[];
}

/**
 * Maps a spec dot-path to the file that defines its top-level module.
 *
 * @param path - Spec dot-path, e.g. "actions.actions[0]".
 * @param moduleFiles - Module key to project-relative file.
 * @returns The file, or `undefined` if the module is unknown.
 */
export function mapFile(path: string, moduleFiles: Record<string, string>): string | undefined {
  const module = path.split(/[.[]/, 1)[0];
  return Object.hasOwn(moduleFiles, module) ? moduleFiles[module] : undefined;
}

/** Longest known-ids list printed in text output before truncating. */
const MAX_KNOWN_IDS = 30;

/** Counts diagnostics by severity. */
export function countDiagnostics(diagnostics: readonly Diagnostic[]): { errors: number; todos: number } {
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  return { errors, todos: diagnostics.length - errors };
}

/** Returns a copy with errors first, then todos; order within each severity is preserved. */
export function sortDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((a, b) => Number(b.severity === "error") - Number(a.severity === "error"));
}

/** Renders one diagnostic as an optional location line, the message line and an optional known-ids line. */
export function formatDiagnostic(d: Diagnostic): string {
  const file = d.file !== undefined && d.line !== undefined ? `${d.file}:${d.line}` : d.file;
  const location = [file, d.path].filter((part) => part !== undefined).join("  ");
  const lines: string[] = [];
  if (location) lines.push(location);
  lines.push(`  ${d.severity} ${d.code}: ${d.message}`);
  if (d.knownIds) {
    const shown = d.knownIds.slice(0, MAX_KNOWN_IDS).join(", ");
    const more = d.knownIds.length > MAX_KNOWN_IDS ? `, … (${d.knownIds.length - MAX_KNOWN_IDS} more)` : "";
    lines.push(`  known ids: ${shown || "(none)"}${more}`);
  }
  return lines.join("\n");
}
