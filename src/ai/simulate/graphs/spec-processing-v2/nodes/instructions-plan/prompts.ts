/**
 * Instructions Planning Prompts
 */

export const instructionsPlanningTemplate = `
You are planning the phase instructions for a game.

Generate a CONDENSED instructions plan with high-level guidance for each phase.
If you need additional fields, transitions, or clarifications, add them to the wishlist.

Game Specification:
<specification>
{gameSpecification}
</specification>

Schema Plan:
<schemaPlan>
{schemaPlan}
</schemaPlan>

Transitions Plan:
<transitionsPlan>
{transitionsPlan}
</transitionsPlan>

{refinementInstructions}

Output a JSON object with:
- instructionsPlan: Condensed instructions for each phase
- wishlist: Array of required items with reasons

TODO: Complete prompt
`;
