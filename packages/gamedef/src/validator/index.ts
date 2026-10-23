/**
 * ChainCraft GameDef Validator
 *
 * Runs a suite of SpecValidator passes over a complete ModularGameSpec.
 * Each validator is a focused, single-responsibility check. Add a new
 * validator by implementing the SpecValidator interface and registering
 * it in the VALIDATORS list below.
 *
 * Validation order:
 *   1. Schema validation  — Zod parse (always first; others assume a valid shape)
 *   2. ResolveRefs        — cross-module forward reference resolution
 *   3. DuplicateIds       — uniqueness of IDs within each module and flow tree
 *   4. FlowIntegrity      — loop termination and flow structural rules
 *   5. FaceTables         — dice face table presence and faceCount/faces exclusivity
 *   6. ActorContext       — effects in actor-less flow hooks must name their players
 *
 * Usage:
 *   import { validate } from "@chaincraft/gamedef/validator";
 *   const result = validate(rawSpec);
 *   if (!result.valid) console.error(result.errors);
 */

import { ModularGameSpecSchema } from "#gamedef/index.js";
import type { ModularGameSpec } from "#gamedef/index.js";
import type { SpecValidator } from "#gamedef/validator/types.js";
import { ResolveRefsValidator } from "#gamedef/validator/validators/resolve-refs.js";
import { DuplicateIdsValidator } from "#gamedef/validator/validators/duplicate-ids.js";
import { FlowIntegrityValidator } from "#gamedef/validator/validators/flow-integrity.js";
import { FaceTablesValidator } from "#gamedef/validator/validators/face-tables.js";
import { ActorContextValidator } from "#gamedef/validator/validators/actor-context.js";

// Re-export types so consumers only need one import path.
export type { ValidationError, ValidationResult, SpecValidator } from "./types.js";

/**
 * Ordered list of spec validators run after schema validation passes.
 * All validators run and their errors are collected together — no early exit.
 * To add a new validator: implement SpecValidator and append an instance here.
 */
const VALIDATORS: SpecValidator[] = [
  new ResolveRefsValidator(),
  new DuplicateIdsValidator(),
  new FlowIntegrityValidator(),
  new FaceTablesValidator(),
  new ActorContextValidator(),
];

/**
 * Validate a raw (unknown) game spec object against the full modular spec schema
 * and all registered SpecValidators.
 *
 * @param raw - The raw object to validate (parsed from JSON/YAML, AI output, etc.)
 */
export function validate(raw: unknown): import("./types.js").ValidationResult {
  // Pass 1: Zod schema validation — must succeed before any SpecValidator runs.
  const parsed = ModularGameSpecSchema.safeParse(raw);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return { valid: false, errors };
  }

  // Passes 2+: run all registered SpecValidators and collect every error.
  const errors = VALIDATORS.flatMap((v) => v.validate(parsed.data));
  if (errors.length > 0) return { valid: false, errors };

  return { valid: true, errors: [], spec: parsed.data as ModularGameSpec };
}

