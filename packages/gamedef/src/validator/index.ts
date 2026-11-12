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
 *   7. MessageTemplate    — message templates may only use tokens the runtime resolves
 *   8. SpecVersion        — metadata.specVersion must not exceed CURRENT_SPEC_VERSION
 *   9. UnusedContent      — warnings for effects, actions and passives nothing references
 * 10. FaceState          — revealed properties and flip effects need a type with hasFaceState
 *
 * Usage:
 *   import { validate } from "@chaincraft/gamedef/validator";
 *   const result = validate(rawSpec);
 *   if (!result.valid) console.error(result.errors);
 */

import { ModularGameSpecSchema } from "#gamedef/index.js";
import type { ModularGameSpec } from "#gamedef/index.js";
import { ValidationCode } from "#gamedef/validator/types.js";
import type { SpecValidator } from "#gamedef/validator/types.js";
import { ResolveRefsValidator } from "#gamedef/validator/validators/resolve-refs.js";
import { DuplicateIdsValidator } from "#gamedef/validator/validators/duplicate-ids.js";
import { FlowIntegrityValidator } from "#gamedef/validator/validators/flow-integrity.js";
import { FaceTablesValidator } from "#gamedef/validator/validators/face-tables.js";
import { ActorContextValidator } from "#gamedef/validator/validators/actor-context.js";
import { MessageTemplateValidator } from "#gamedef/validator/validators/message-template.js";
import { SpecVersionValidator } from "#gamedef/validator/validators/spec-version.js";
import { UnusedContentValidator } from "#gamedef/validator/validators/unused-content.js";
import { FaceStateValidator } from "#gamedef/validator/validators/face-state.js";
import { schemaIssues } from "#gamedef/validator/schema-issues.js";

// Re-export types so consumers only need one import path.
export type { ValidationError, ValidationResult, SpecValidator } from "./types.js";
export { ValidationCode } from "#gamedef/validator/types.js";
export { schemaIssues } from "#gamedef/validator/schema-issues.js";
export type { SchemaIssue } from "#gamedef/validator/schema-issues.js";

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
  new MessageTemplateValidator(),
  new SpecVersionValidator(),
  new UnusedContentValidator(),
  new FaceStateValidator(),
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
    const errors = schemaIssues(parsed.error).map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
      code: ValidationCode.Schema,
    }));
    return { valid: false, errors, warnings: [] };
  }

  // Passes 2+: run all registered SpecValidators and collect every finding.
  const findings = VALIDATORS.flatMap((v) => v.validate(parsed.data));
  const errors = findings.filter((f) => f.severity !== "warning");
  const warnings = findings.filter((f) => f.severity === "warning");
  if (errors.length > 0) return { valid: false, errors, warnings };

  return { valid: true, errors: [], warnings, spec: parsed.data as ModularGameSpec };
}

