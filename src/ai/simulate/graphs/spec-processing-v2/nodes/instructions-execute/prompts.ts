/**
 * Instructions Execution Prompts
 */

export const instructionsExecutionTemplate = `
You are generating the final detailed phase instructions for a game.

You have a reconciled instructions plan, complete schema, and complete transitions.
Expand the plan into detailed instructions for each phase and transition.

Game Specification:
<specification>
{gameSpecification}
</specification>

Complete State Schema:
<stateSchema>
{stateSchema}
</stateSchema>

Complete Transitions:
<stateTransitions>
{stateTransitions}
</stateTransitions>

Reconciled Instructions Plan:
<instructionsPlan>
{instructionsPlan}
</instructionsPlan>

Generate complete instructions for all phases and transitions.

TODO: Complete prompt
`;
