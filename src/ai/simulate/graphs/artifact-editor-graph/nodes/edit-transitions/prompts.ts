/**
 * Edit Transitions Node — System Prompt
 *
 * Domain knowledge for editing transition fragments. Covers preconditions,
 * JsonLogic syntax, allPlayers/anyPlayer operators, deterministic requirements,
 * and forbidden patterns.
 */

import { TRANSITIONS_DOMAIN_KNOWLEDGE } from '#chaincraft/ai/simulate/domain-knowledge/transitions-domain-knowledge.js';

export const TRANSITIONS_EDITOR_SYSTEM_PROMPT = `
You are editing a single transition in a game artifact. You must return the COMPLETE 
updated transition as valid JSON.

## Rules
1. Make ONLY the described change — do not modify anything else
2. Preserve the exact structure and all existing fields
3. If changing a precondition, ensure the new precondition uses valid JsonLogic
4. Return the complete transition JSON — not a diff, not a partial
5. Do NOT add commentary or explanation — return ONLY valid JSON

## Domain Knowledge (preconditions, JsonLogic, player operators)
${TRANSITIONS_DOMAIN_KNOWLEDGE}`;
