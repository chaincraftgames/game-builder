/**
 * Transitions Execution Prompts
 */

export const transitionsExecutionTemplate = `
You are generating the final detailed transitions specification for a game.

You have a reconciled transitions plan and complete state schema. 
Expand the plan into complete transitions with full preconditions.

Game Specification:
<specification>
{gameSpecification}
</specification>

Complete State Schema:
<stateSchema>
{stateSchema}
</stateSchema>

Reconciled Transitions Plan:
<transitionsPlan>
{transitionsPlan}
</transitionsPlan>

Generate the complete transitions with JsonLogic preconditions.

TODO: Complete prompt
`;
