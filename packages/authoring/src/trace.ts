import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Diagnostic } from "#authoring/diagnostics.js";
import type { Versions } from "#authoring/versions.js";

/** Project-relative directory for local, git-ignored tool state. */
export const TRACE_DIR = ".chaincraft";

/** One line of `.chaincraft/log.jsonl`. */
export interface TraceEntry {
  /** ISO 8601 */
  ts: string;
  command: string;
  args: string[];
  versions: Versions;
  durationMs: number;
  exitCode: number;
  counts: { errors: number; warnings: number; todos: number };
  /** Distinct diagnostic codes, in first-seen order. */
  codes: string[];
  /** Playtest only: the run summary. */
  summary?: unknown;
  diagnostics: Diagnostic[];
}

/** Appends `entry` to the project's trace log; failures are swallowed so tracing never alters a command. */
export function appendTrace(root: string, entry: TraceEntry): void {
  try {
    const dir = join(root, TRACE_DIR);
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "log.jsonl"), `${JSON.stringify(entry)}\n`);
  } catch {
    // intentionally ignored
  }
}
