/**
 * Artifact Editor Graph — Shared Node Types & Utilities
 *
 * Common types, fragment operations types, address parsing, and the
 * shared user prompt builder used across all artifact editor graph nodes.
 */

import { SystemMessagePromptTemplate } from '@langchain/core/prompts';

/** Maximum number of coordinator → edit → revalidate cycles */
export const MAX_EDIT_ATTEMPTS = 2;

// ─── Fragment Op Types ───

export interface FragmentResult {
  fragment: string;       // JSON string of the extracted fragment
  found: boolean;
}

export interface ReplaceResult {
  artifact: string;       // Full artifact JSON string with replacement applied
  replaced: boolean;
}

// ─── Address Parsing ───

export type ParsedAddress =
  | { type: 'transitionInstruction'; key: string }
  | { type: 'playerPhaseInstruction'; key: string }
  | { type: 'transition'; key: string };

/**
 * Parse a fragmentAddress from a ChangePlan into a typed address.
 *
 * The coordinator produces addresses like:
 *   - "transitionInstructions.battle_generated"
 *   - "playerPhaseInstructions.character_creation"
 *   - "both_characters_submitted"  (bare transition ID for transitions artifact)
 */
export function parseFragmentAddress(
  artifactType: 'schema' | 'transitions' | 'instructions',
  fragmentAddress: string,
): ParsedAddress {
  if (artifactType === 'transitions') {
    const key = fragmentAddress.replace(/^transitions\./, '');
    return { type: 'transition', key };
  }

  if (artifactType === 'instructions') {
    // Canonical form: transitionInstructions.<id>
    if (fragmentAddress.startsWith('transitionInstructions.')) {
      return {
        type: 'transitionInstruction',
        key: fragmentAddress.replace('transitionInstructions.', ''),
      };
    }
    // Canonical form: playerPhaseInstructions.<phaseName>
    if (fragmentAddress.startsWith('playerPhaseInstructions.')) {
      return {
        type: 'playerPhaseInstruction',
        key: fragmentAddress.replace('playerPhaseInstructions.', ''),
      };
    }
    // Coordinator shorthand: transitions.<transitionId>
    if (fragmentAddress.startsWith('transitions.')) {
      return {
        type: 'transitionInstruction',
        key: fragmentAddress.replace('transitions.', ''),
      };
    }
    // Coordinator shorthand: playerPhases.<phaseName> or playerPhases.<phaseName>.<actionId>
    if (fragmentAddress.startsWith('playerPhases.')) {
      const rest = fragmentAddress.replace('playerPhases.', '');
      const key = rest.split('.')[0]; // Phase name is the map key
      return { type: 'playerPhaseInstruction', key };
    }
    // Bare key — assume transition instruction ID
    return { type: 'transitionInstruction', key: fragmentAddress };
  }

  throw new Error(`Schema fragment ops not yet implemented. Address: ${fragmentAddress}`);
}

// ─── Editor Types ───

export interface FragmentEditInput {
  /** JSON string of the fragment to edit */
  fragment: string;
  /** Fragment address for context (e.g., "transitionInstructions.battle_generated") */
  fragmentAddress: string;
  /** Natural language description of what to change */
  changeDescription: string;
  /** Schema fields summary for context */
  schemaFields: string;
  /** Game spec summary (optional, for game-context-heavy edits) */
  gameSpecification?: string;
  /** The validation errors motivating this change */
  validationErrors?: string[];
}

export interface FragmentEditOutput {
  /** The updated fragment as a parsed object */
  updatedFragment: unknown;
  /** Whether the edit succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

// ─── System Prompt Builder ───

/**
 * Build a complete system prompt for a fragment edit.
 * Processes the base prompt through SystemMessagePromptTemplate.fromTemplate()
 * to resolve template escape sequences (e.g., {{{{winnerId}}}} → {{winnerId}}),
 * then appends the per-call variable data (fragment, change, errors) after the
 * static domain knowledge prefix, enabling prefix caching.
 */
export async function buildEditorSystemPrompt(
  baseSystemPrompt: string,
  input: FragmentEditInput,
): Promise<string> {
  // Process domain-knowledge base prompt through the template engine to resolve
  // escape sequences — the domain knowledge uses {{{{ }}}} escaping (for
  // compatibility with SystemMessagePromptTemplate in extraction paths).
  // Without this, the LLM would see quadruple braces instead of double.
  const resolved = await SystemMessagePromptTemplate.fromTemplate(
    baseSystemPrompt
  ).format({});
  const parts: string[] = [resolved.content as string];

  parts.push('');
  parts.push('## Edit Task');
  parts.push('');

  parts.push(`### Fragment to Edit (${input.fragmentAddress})`);
  parts.push('```json');
  parts.push(input.fragment);
  parts.push('```');
  parts.push('');

  parts.push('### Available State Fields');
  parts.push(input.schemaFields);
  parts.push('');

  parts.push('### Change Required');
  parts.push(input.changeDescription);

  if (input.validationErrors?.length) {
    parts.push('');
    parts.push('### Validation Errors to Resolve');
    input.validationErrors.forEach((e, i) => parts.push(`${i + 1}. ${e}`));
  }

  if (input.gameSpecification) {
    parts.push('');
    parts.push('### Game Specification (for context)');
    parts.push(input.gameSpecification);
  }

  parts.push('');
  parts.push('Return the COMPLETE updated fragment as valid JSON.');

  return parts.join('\n');
}
