/**
 * Artifact Editor Types
 *
 * Zod schemas and TypeScript types for the coordinator's structured output
 * and the coordinator's input interface. Used by the coordinator node and
 * referenced by tests.
 */

import { z } from 'zod';

// ─── Schema Operations (deterministic, applied by edit_schema node) ───

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
    'The field name to add or remove (e.g. "battleWinnerId", "completeCharacterProfile")'
  ),
  type: z.string().optional().describe(
    'Field type (required for addField). ' +
    'e.g. "string", "number", "boolean", "object", "array"'
  ),
  description: z.string().optional().describe(
    'Human-readable description/purpose for the field (used for addField)'
  ),
});

export type SchemaOp = z.infer<typeof SchemaOpSchema>;

// ─── Coordinator Output Schema ───

export const ArtifactChangeSchema = z.object({
  artifact: z.enum(['schema', 'transitions', 'instructions', 'mechanics']).describe(
    'Which artifact type needs to be changed'
  ),
  operation: z.enum(['patch', 'reextract']).describe(
    'patch = surgical edit to a specific fragment. ' +
    'reextract = re-run the full extraction with error context.'
  ),
  fragmentAddress: z.string().optional().describe(
    'For patches: the specific fragment to edit. ' +
    'Schema: field name (e.g. "game.battleNarrative"). ' +
    'Transitions: transition ID (e.g. "narrative_displayed"). ' +
    'Instructions: "transitions.<transitionId>" or "playerPhases.<phaseName>.<actionId>". ' +
    'Mechanics: mechanic ID (e.g. "resolve_round_outcome")'
  ),
  description: z.string().describe(
    'Natural language description of what to change. ' +
    'Say WHAT to change, not HOW (the editor knows the syntax).'
  ),
  errorsAddressed: z.array(z.string()).describe(
    'Which validation error messages this change resolves (exact strings)'
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
    'transitions, transitions before instructions.'
  ),
  schemaOps: z.array(SchemaOpSchema).optional().describe(
    'Structured schema operations for deterministic application. ' +
    'Required when any change has artifact="schema". ' +
    'Applied in order before any LLM-based edits.'
  ),
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
