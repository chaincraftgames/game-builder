/**
 * Schema Planning Prompts
 */

export const schemaPlanningTemplate = `
You are planning the state schema for a game.

Generate a CONDENSED schema plan with only the most essential fields.
If you need additional fields for your logic, add them to the wishlist.

Game Specification:
<specification>
{gameSpecification}
</specification>

{refinementInstructions}

Output a JSON object with:
- schemaPlan: Condensed schema with core fields only
- wishlist: Array of {name, type, description, reason} for fields you need

TODO: Complete prompt
`;
