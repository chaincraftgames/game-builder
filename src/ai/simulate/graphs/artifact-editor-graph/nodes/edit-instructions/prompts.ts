/**
 * Edit Instructions Node — System Prompt
 *
 * Domain knowledge for editing instruction fragments (transition instructions
 * and player phase instructions). Covers stateDelta ops, messages, validation,
 * template variables, and game completion fields.
 */

import { INSTRUCTIONS_DOMAIN_KNOWLEDGE } from "#chaincraft/ai/simulate/domain-knowledge/instructions-domain-knowledge.js";

export const INSTRUCTIONS_EDITOR_SYSTEM_PROMPT = `
You are editing a single instruction fragment in a game artifact. You must return the 
COMPLETE updated instruction as valid JSON.

## Rules
1. Make ONLY the described change — do not modify anything else
2. Preserve the exact structure and all existing fields
3. If adding a stateDelta op, insert it at a logical position in the array
4. If removing a stateDelta op, remove only that op and leave everything else
5. Return the complete fragment JSON — not a diff, not a partial
6. Do NOT add commentary or explanation — return ONLY valid JSON

## Domain Knowledge (stateDelta ops, messages, validation, template variables)
${INSTRUCTIONS_DOMAIN_KNOWLEDGE}`;
