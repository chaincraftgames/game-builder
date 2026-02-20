/**
 * Artifact Editor Types
 * 
 * Minimal types for the coordinator spike. Will be expanded
 * as we build fragment editors and the full subgraph.
 */

import { z } from 'zod';

// ─── Coordinator Output Schema ───

export const ArtifactChangeSchema = z.object({
  artifact: z.enum(['schema', 'transitions', 'instructions']).describe(
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
    'Instructions: "transitions.<transitionId>" or "playerPhases.<phaseName>.<actionId>"'
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
});

export type ArtifactChange = z.infer<typeof ArtifactChangeSchema>;
export type ChangePlan = z.infer<typeof ChangePlanSchema>;

// ─── Coordinator Input ───

export interface CoordinatorInput {
  gameSpecification: string;
  validationErrors: string[];
  schemaFields: string;
  stateTransitions: string;
  playerPhaseInstructions: string;
  transitionInstructions: string;
}
