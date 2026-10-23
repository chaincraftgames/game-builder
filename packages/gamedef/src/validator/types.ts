/**
 * Shared validator types for @chaincraft/gamedef.
 *
 * A SpecValidator is a focused, single-responsibility check run against a
 * fully Zod-parsed ModularGameSpec. Validators are collected into a list and
 * run in order by validate() in index.ts — add a new file under validators/
 * and register it there to extend the validation suite.
 */

import type { ModularGameSpec } from "#gamedef/index.js";

export interface ValidationError {
  /** Dot-path to the field that failed, e.g. "actions.actions[0].effects[1]" */
  path: string;
  /** Human-readable description of the failure */
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  /** The parsed + coerced spec if schema validation passed, undefined otherwise */
  spec?: ModularGameSpec;
}

/**
 * Common interface for all spec validators.
 *
 * Each validator focuses on one category of cross-schema rule (reference
 * resolution, duplicate IDs, structural integrity, etc.). Validators are
 * stateless — a new instance is created per validate() call, or a single
 * instance can be shared since validate() takes the spec as a parameter.
 */
export interface SpecValidator {
  /** Short identifier shown in error reporting and debug output. */
  readonly name: string;
  /**
   * Run this validator against a spec that has already passed Zod schema
   * validation. Returns an array of errors; empty array means all checks pass.
   */
  validate(spec: ModularGameSpec): ValidationError[];
}
