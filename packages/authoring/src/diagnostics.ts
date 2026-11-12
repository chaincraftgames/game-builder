import type { CompileCode } from "@chaincraft/compiler";
import { ValidationCode } from "@chaincraft/gamedef/validator";
import type { FindingCode } from "#authoring/tools/playtest/checks.js";

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
  UnknownTopic: "unknown-topic",
} as const;

export type AuthoringCode = (typeof AuthoringCode)[keyof typeof AuthoringCode];

/** Any code a {@link Diagnostic} can carry, across gamedef, compiler and authoring. */
export type DiagnosticCode = ValidationCode | CompileCode | AuthoringCode | FindingCode;

/** Codes that draft mode downgrades to `todo`. */
export const DRAFT_TODO_CODES: ReadonlySet<DiagnosticCode> = new Set<DiagnosticCode>([
  ValidationCode.UnresolvedRef,
  AuthoringCode.MissingModule,
]);

/** `error` fails a command; `warning` (dead content) and `todo` (draft-mode placeholder) do not. */
export type Severity = "error" | "warning" | "todo";

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
  /** Playtest token that reproduces the game that showed it, e.g. "p2-s1-g3". */
  repro?: string;
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
export function countDiagnostics(diagnostics: readonly Diagnostic[]): { errors: number; warnings: number; todos: number } {
  const count = (severity: Severity) => diagnostics.filter((d) => d.severity === severity).length;
  return { errors: count("error"), warnings: count("warning"), todos: count("todo") };
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, todo: 2 };

/** Returns a copy with errors first, then warnings, then todos; order within each severity is preserved. */
export function sortDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/**
 * One-line pointer to the schema docs for the first schema-shaped problem, or `undefined` if there is none.
 *
 * @param moduleKeys - Valid top-level module keys; the pointer names a module only if the path starts with one.
 */
export function schemaPointer(diagnostics: readonly Diagnostic[], moduleKeys: readonly string[]): string | undefined {
  const issue = sortDiagnostics(diagnostics).find(
    (d) => d.code === ValidationCode.Schema || d.code === AuthoringCode.UnknownModule,
  );
  if (!issue) return undefined;
  const segment = (issue.path ?? "").split(/[.[]/, 1)[0];
  const module = issue.code === ValidationCode.Schema && moduleKeys.includes(segment) ? ` ${segment}` : "";
  return `see \`chaincraft docs schema${module}\``;
}

/** Renders one diagnostic as an optional location line, the message line and an optional known-ids line. */
export function formatDiagnostic(d: Diagnostic, maxKnownIds: number = MAX_KNOWN_IDS): string {
  const file = d.file !== undefined && d.line !== undefined ? `${d.file}:${d.line}` : d.file;
  const location = [file, d.path].filter((part) => part !== undefined).join("  ");
  const lines: string[] = [];
  if (location) lines.push(location);
  lines.push(`  ${d.severity} ${d.code}: ${d.message.replaceAll("\n", "\n  ")}`);
  if (d.repro !== undefined) lines.push(`  repro: ${d.repro}`);
  if (d.knownIds) {
    const shown = d.knownIds.slice(0, maxKnownIds).join(", ");
    const more = d.knownIds.length > maxKnownIds ? `, … (${d.knownIds.length - maxKnownIds} more)` : "";
    lines.push(`  known ids: ${shown || "(none)"}${more}`);
  }
  return lines.join("\n");
}
