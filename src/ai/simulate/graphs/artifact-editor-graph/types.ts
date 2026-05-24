/**
 * Artifact Editor Types
 *
 * Zod schemas and TypeScript types for the coordinator's structured output
 * and the coordinator's input interface. Used by the coordinator node and
 * referenced by tests.
 */

import { z } from 'zod';

// ─── Schema Operations (deterministic, applied by edit_schema node) ───

/** Sub-field definition for array-of-objects or object fields (mirrors objectSubFieldSchema in extract-schema/schema.ts). */
const SchemaOpSubFieldSchema = z.object({
  name: z.string(),
  type: z.string(),
  path: z.enum(['game', 'player']),
  purpose: z.string(),
  enumValues: z.array(z.string()).optional(),
  valueType: z.string().optional(),
  required: z.boolean().optional(),
});

export const SchemaOpSchema = z.object({
  op: z.enum(['addField', 'removeField']).describe(
    'addField = add a new field to the schema. ' +
    'removeField = remove an existing field from the schema.'
  ),
  scope: z.enum(['game', 'player']).describe(
    'Which schema scope to modify. ' +
    'game = game-level state field. player = per-player state field.'
  ),
  field: z.string().describe(
    'The field name to add or remove (e.g. "battleWinnerId", "weapons")'
  ),
  type: z.string().optional().describe(
    'Field type (required for addField). ' +
    'e.g. "string", "number", "boolean", "object", "array", "enum", "record"'
  ),
  description: z.string().optional().describe(
    'Human-readable description/purpose for the field (used for addField)'
  ),
  valueType: z.string().optional().describe(
    'Inner element type when type is "array" or "record". ' +
    'Use "object" when each array element has multiple typed sub-fields.'
  ),
  enumValues: z.array(z.string()).optional().describe(
    'Allowed values when type or valueType is "enum".'
  ),
  fields: z.array(SchemaOpSubFieldSchema).optional().describe(
    'Sub-field definitions when type is "object" OR when type is "array" and valueType is "object". ' +
    'Required for structured arrays — omitting produces untyped unknown[] in generated code.'
  ),
  required: z.boolean().optional().describe(
    'Whether the field is required. Defaults to true if omitted.'
  ),
});

export type SchemaOp = z.infer<typeof SchemaOpSchema>;

// ─── Coordinator Output Schema ───

export const ArtifactChangeSchema = z.object({
  artifact: z.enum(['schema', 'transitions', 'instructions', 'mechanics']).describe(
    'Which artifact type needs to be changed'
  ),
  operation: z.enum(['patch', 'add', 'reextract']).describe(
    'patch = surgical edit to a specific fragment. ' +
    'add = append a brand-new transition to the transitions artifact (use when the fix requires a transition that does not yet exist). ' +
    'reextract = re-run the full extraction with error context.'
  ),
  fragmentAddress: z.string().nullish().describe(
    'For patches: the specific fragment to edit. ' +
    'Schema: field name (e.g. "game.battleNarrative"). ' +
    'Transitions: transition ID (e.g. "narrative_displayed"). ' +
    'Instructions: "transitions.<transitionId>" or "playerPhases.<phaseName>.<actionId>". ' +
    'Mechanics: mechanic ID (e.g. "resolve_round_outcome"). ' +
    'For add (transitions only): the ID to assign to the new transition (e.g. "resolve_bid_continue"). ' +
    'Omit or set to null for reextract operations.'
  ),
  description: z.string().describe(
    'Natural language description of what to change. ' +
    'Say WHAT to change, not HOW (the editor knows the syntax).'
  ),
  errorsAddressed: z.array(z.string()).optional().default([]).describe(
    'Which validation error messages this change resolves (exact strings). ' +
    'May be empty for coherence-repair changes where errors are not TypeScript messages.'
  ),
  schemaOps: z.array(SchemaOpSchema).optional().describe(
    'Structured schema operations for deterministic application. ' +
    'REQUIRED when artifact="schema" and operation != "reextract". ' +
    'Applied deterministically — no LLM used. ' +
    'Only valid on changes with artifact="schema".'
  ),
});

export const ChangePlanSchema = z.object({
  diagnosis: z.string().describe(
    'Brief root cause analysis. What is fundamentally wrong and why.'
  ),
  confidence: z.enum(['high', 'medium', 'low']).describe(
    'How confident are you this plan will resolve all errors'
  ),
  changes: z.array(ArtifactChangeSchema).describe(
    'Ordered list of changes. Apply in order. Schema changes before ' +
    'transitions, transitions before instructions. ' +
    'When artifact="schema" and operation != "reextract", the change MUST include a non-empty schemaOps array.'
  ),
}).superRefine((val, ctx) => {
  val.changes.forEach((change, idx) => {
    if (change.artifact === 'schema' && change.operation !== 'reextract') {
      if (!change.schemaOps || change.schemaOps.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['changes', idx, 'schemaOps'],
          message:
            'schemaOps is required on schema changes. ' +
            'Populate schemaOps with addField/removeField operations inside this change item.',
        });
      }
    }
  });
});

export type ArtifactChange = z.infer<typeof ArtifactChangeSchema>;
export type ChangePlan = z.infer<typeof ChangePlanSchema>;

// ─── Coordinator Input (used by tests that invoke the coordinator directly) ───

export interface CoordinatorInput {
  gameSpecification: string;
  validationErrors: string[];
  schemaFields: string;
  stateTransitions: string;
  playerPhaseInstructions: string;
  transitionInstructions: string;
  /** Generated mechanic code keyed by mechanic ID (optional — only when mechanics exist) */
  generatedMechanics?: Record<string, string>;
  /** TypeScript interfaces for schema context (optional — only when mechanics exist) */
  stateInterfaces?: string;
}
