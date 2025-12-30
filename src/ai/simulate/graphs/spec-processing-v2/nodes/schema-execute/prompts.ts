/**
 * Schema Execution Prompts
 */

export const schemaExecutionTemplate = `
You are generating the final detailed state schema for a game.

You have a reconciled schema plan. Expand it into a complete, detailed schema.

Game Specification:
<specification>
{gameSpecification}
</specification>

Reconciled Schema Plan:
<schemaPlan>
{schemaPlan}
</schemaPlan>

Generate the complete state schema with full field definitions, types, and descriptions.

TODO: Complete prompt
`;
