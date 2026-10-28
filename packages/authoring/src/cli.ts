#!/usr/bin/env node
import { parseArgs } from "node:util";
import { COMMANDS, USAGE, type Command } from "./commands.js";
import {
  AuthoringCode,
  countDiagnostics,
  formatDiagnostic,
  sortDiagnostics,
  type Diagnostic,
} from "./diagnostics.js";
import { findProjectRoot, ManifestError, MANIFEST_FILE, readManifest, type Manifest } from "./project.js";
import { compile, type CompileSummary } from "./tools/compile.js";
import { init, InitConflictError } from "./tools/init.js";
import { validate } from "./tools/validate.js";
import { appendTrace } from "./trace.js";
import { getVersions, type Versions } from "./versions.js";

/** Result of one command, shared by the text, JSON and trace outputs. */
interface Outcome {
  /** Drives the exit code: true -> 0, false -> 1. */
  ok: boolean;
  diagnostics: Diagnostic[];
  /** Compile only, on success. */
  summary?: CompileSummary;
  /** Init only, on success; project-relative targets. */
  created?: string[];
}

/** Parses `argv` strictly; throws on unknown flags. */
function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: { json: { type: "boolean" }, draft: { type: "boolean" }, version: { type: "boolean" } },
  });
}

/** First line of every text output, also printed by `--version`. */
function headerLine(versions: Versions): string {
  return `chaincraft ${versions.authoring} (runtime ${versions.runtime})`;
}

/** One-line warning when the manifest's engine pins differ from the installed versions; otherwise `undefined`. */
function pinWarning(manifest: Manifest, versions: Versions): string | undefined {
  /** Human-readable description of each pin that differs. */
  const drift: string[] = [];
  if (manifest.engine.authoring !== versions.authoring) {
    drift.push(`authoring ${manifest.engine.authoring} (installed ${versions.authoring})`);
  }
  if (manifest.engine.runtime !== versions.runtime) {
    drift.push(`runtime ${manifest.engine.runtime} (installed ${versions.runtime})`);
  }
  return drift.length > 0 ? `warning: ${MANIFEST_FILE} pins ${drift.join(", ")}` : undefined;
}

/** Renders the default text output: header, created files, diagnostics (errors first) and a footer. */
function formatText(outcome: Outcome, versions: Versions): string {
  /** Blank-line separated sections of the output. */
  const blocks = [headerLine(versions)];
  if (outcome.created) blocks.push(outcome.created.map((p) => `  created ${p}`).join("\n"));
  blocks.push(...sortDiagnostics(outcome.diagnostics).map(formatDiagnostic));

  const { errors, todos } = countDiagnostics(outcome.diagnostics);
  /** Formats a count with a naive English plural, e.g. "1 error", "2 errors". */
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (errors === 0 && todos === 0) {
    const s = outcome.summary;
    blocks.push(s ? `OK (${s.actions} actions, ${s.effectDefs} effects, ${s.flowNodes} flow nodes)` : "OK");
  } else {
    blocks.push(`${plural(errors, "error")}, ${plural(todos, "todo")}`);
  }
  return blocks.join("\n\n");
}

/**
 * Runs `init` in `cwd`, turning a conflict into a diagnostic.
 *
 * @param root - Project root found from `cwd`, if any.
 * @returns The outcome and the directory to write the trace to, if any.
 */
function runInit(cwd: string, root: string | undefined): { outcome: Outcome; traceRoot?: string } {
  try {
    return { outcome: { ok: true, diagnostics: [], created: init(cwd).created }, traceRoot: cwd };
  } catch (err) {
    if (!(err instanceof InitConflictError)) throw err;
    const diagnostic: Diagnostic = { severity: "error", code: err.code, message: err.message };
    // Logging into a directory that is not yet a project would create .chaincraft/ and block a retry.
    return { outcome: { ok: false, diagnostics: [diagnostic] }, traceRoot: root === cwd ? cwd : undefined };
  }
}

/**
 * Runs `validate` or `compile` in the project at `root`; an invalid manifest becomes a diagnostic.
 *
 * @param draft - Only meaningful for `validate`.
 * @returns The outcome and an optional engine-pin warning for stderr.
 */
function runProjectCommand(
  command: "validate" | "compile",
  root: string,
  draft: boolean,
  versions: Versions,
): { outcome: Outcome; warning?: string } {
  let manifest: Manifest;
  try {
    manifest = readManifest(root);
  } catch (err) {
    if (!(err instanceof ManifestError)) throw err;
    const diagnostic: Diagnostic = {
      severity: "error",
      code: AuthoringCode.InvalidManifest,
      message: err.message,
      file: MANIFEST_FILE,
    };
    return { outcome: { ok: false, diagnostics: [diagnostic] } };
  }
  const warning = pinWarning(manifest, versions);
  if (command === "validate") {
    const { ok, diagnostics } = validate(root, { draft });
    return { outcome: { ok, diagnostics }, warning };
  }
  const { ok, diagnostics, summary } = compile(root);
  return { outcome: { ok, diagnostics, ...(summary ? { summary } : {}) }, warning };
}

/**
 * Runs one CLI invocation: parses `argv`, executes the command, prints, and appends a trace entry.
 *
 * @param argv - Arguments after the executable, e.g. `["validate", "--draft"]`.
 * @param cwd - Working directory.
 * @returns Exit code: 0 ok, 1 errors, 2 usage error.
 */
function main(argv: string[], cwd: string): number {
  /** Epoch ms, for `durationMs` in the trace. */
  const started = Date.now();
  const versions = getVersions();
  /** Nearest enclosing project, if any. */
  const root = findProjectRoot(cwd);

  /** Appends a trace entry to `traceRoot`; no-op when there is no project. */
  const trace = (traceRoot: string | undefined, command: string, exitCode: number, diagnostics: Diagnostic[]) => {
    if (!traceRoot) return;
    appendTrace(traceRoot, {
      ts: new Date().toISOString(),
      command,
      args: argv,
      versions,
      durationMs: Date.now() - started,
      exitCode,
      counts: countDiagnostics(diagnostics),
      diagnostics,
    });
  };

  /** Prints `message` plus usage to stderr, traces it, and returns exit code 2. */
  const usageError = (message: string, command: string): number => {
    console.error(`chaincraft: ${message}\n\n${USAGE}`);
    trace(root, command, 2, []);
    return 2;
  };

  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (err) {
    return usageError((err as Error).message, argv[0] ?? "");
  }
  /** `values` holds the flags, `positionals` the command and any extra arguments. */
  const { values, positionals } = parsed;

  if (values.version) {
    console.log(headerLine(versions));
    return 0;
  }
  const [name, ...extra] = positionals;
  if (name === undefined) return usageError("no command given", "");
  if (!(COMMANDS as readonly string[]).includes(name)) return usageError(`unknown command "${name}"`, name);
  const command = name as Command;
  if (extra.length > 0) return usageError(`unexpected argument "${extra[0]}"`, command);
  if (values.draft && command !== "validate") return usageError("--draft is only valid for validate", command);

  if (command === "help") {
    console.log(USAGE);
    return 0;
  }

  let outcome: Outcome;
  /** Printed to stderr so it never pollutes `--json` on stdout. */
  let warning: string | undefined;
  /** Where to write the trace; differs from `root` for `init`. */
  let traceRoot: string | undefined = root;
  if (command === "init") {
    ({ outcome, traceRoot } = runInit(cwd, root));
  } else if (root === undefined) {
    console.error("Not a ChainCraft project (no chaincraft.yaml found). Run chaincraft init.");
    return 1;
  } else {
    ({ outcome, warning } = runProjectCommand(command, root, values.draft ?? false, versions));
  }

  if (warning) console.error(warning);
  if (values.json) {
    console.log(JSON.stringify({ command, ...outcome, versions }, null, 2));
  } else {
    console.log(formatText(outcome, versions));
  }

  /** 0 when `outcome.ok` (todos allowed), else 1. */
  const exitCode = outcome.ok ? 0 : 1;
  trace(traceRoot, command, exitCode, outcome.diagnostics);
  return exitCode;
}

process.exitCode = main(process.argv.slice(2), process.cwd());
