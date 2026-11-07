import type { CompileCode } from "#compiler/assembler/types.js";

export interface CompileIssue {
  code: CompileCode;
  message: string;
  ref?: string;
  knownIds?: string[];
  /** Spec dot-path with bracket indices, e.g. `flow.root.children[0].actor.player`. */
  path?: string;
}

export class CompileError extends Error {
  constructor(readonly issues: CompileIssue[]) {
    super(`Module link/validate failed:\n  ${issues.map((i) => i.message).join("\n  ")}`);
    this.name = "CompileError";
  }
}

/** A single-issue {@link CompileError}. */
export function compileFailure(code: CompileCode, message: string, path?: string): CompileError {
  return new CompileError([{ code, message, ...(path !== undefined && { path }) }]);
}
