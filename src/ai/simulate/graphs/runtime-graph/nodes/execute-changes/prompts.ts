/**
 * Prompt for Execute Changes Node
 * 
 * Formats planned changes as valid JSON state
 */

export const executeChangesTemplate = `
You are formatting planned state changes into valid JSON.

Planned Changes:
<changes>
{plannedChanges}
</changes>

Current State (JSON):
<state>
{gameState}
</state>

State Schema:
<schema>
{stateSchema}
</schema>

Your task: Generate the COMPLETE updated game state as valid JSON.

CRITICAL RULES:
1. Start with the current state as your base
2. Apply ONLY the specific changes listed in the plan
3. Keep ALL fields that are not mentioned in the changes (unchanged fields stay the same)
4. Maintain the exact structure defined in the schema
5. Include ALL top-level objects (game, players, etc.)
6. Include ALL players with ALL their fields
7. Preserve data types (numbers as numbers, not strings)
8. Use null for optional fields that should be cleared
9. Follow the schema structure exactly

Common mistakes to avoid:
- Don't omit unchanged fields
- Don't omit any players
- Don't change field types
- Don't add fields not in schema
- Don't use placeholder values

Return ONLY the complete JSON state, no explanations or markdown.
`;
