/**
 * Refinement/Coordination Prompts
 */

export const coordinationTemplate = `
You are coordinating three planning agents that generated game artifacts.

Your job is to identify conflicts and generate targeted refinement instructions.

Game Specification:
<specification>
{gameSpecification}
</specification>

Schema Plan + Wishlist:
<schema>
{schemaPlan}
{schemaWishlist}
</schema>

Transitions Plan + Wishlist:
<transitions>
{transitionsPlan}
{transitionsWishlist}
</transitions>

Instructions Plan + Wishlist:
<instructions>
{instructionsPlan}
{instructionsWishlist}
</instructions>

Validation Issues (deterministic checks):
<validationIssues>
{validationIssues}
</validationIssues>

Generate refinement instructions for each agent that has issues.
Be specific about what needs to be added/changed.

TODO: Complete prompt
`;
