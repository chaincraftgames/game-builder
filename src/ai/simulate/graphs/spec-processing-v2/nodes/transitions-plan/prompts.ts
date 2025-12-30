/**
 * Transitions Planning Prompts
 */

export const transitionsPlanningTemplate = `
You are planning the phase transitions for a game.

Generate a CONDENSED transitions plan focusing on high-level phase flow.
If you need additional fields or transitions, add them to the wishlist.

Game Specification:
<specification>
{gameSpecification}
</specification>

Schema Plan:
<schemaPlan>
{schemaPlan}
</schemaPlan>

{refinementInstructions}

Output a JSON object with:
- transitionsPlan: Condensed phase flow with key transitions
- wishlist: Array of required fields/transitions with reasons

TODO: Complete prompt
`;
