/**
 * Minimal Prompts for Instructions Extraction
 */

export const planInstructionsMinimalTemplate = `
!___ CACHE:universal-instructions-minimal ___!
# Planner Output Schema
<planningSchema>
{planningSchemaJson}
</planningSchema>

# Your Task

Analyze the game specification and transitions to extract semantic information needed for instruction execution.

Focus on:
- **Game mechanics/rules**: Win conditions, scoring, trump rules, costs, constraints
- **LLM requirements**: Does this need LLM reasoning or semantic validation?
- **Message purposes**: Brief description of what messages should convey
- **Randomness**: Probability distributions, ranges, what values are needed

# Output Rules

1. **Player Actions**: Provide hints ONLY for phases requiring player input
2. **Transitions**: Provide hints for EVERY automatic transition  
3. **mechanicsDescription**: Natural language rules (null if purely administrative)
4. **requiresLLMValidation/requiresLLMReasoning**: Boolean flags
5. **Message purposes**: Brief strings (null if no message needed)

# Critical Fields (mention in globalNotes)
- **game.gameEnded**: At least one transition must set this to true
- **players.{{playerId}}.isGameWinner**: Set in transitions leading to finished phase
- **players.{{playerId}}.actionRequired**: Every player action must set this

Return EXACTLY one JSON object matching the schema.
!___ END-CACHE ___!

!___ CACHE:design-spec ___!
# Game Specification
<specification>
{gameSpecification}
</specification>

# Narrative Markers Available
{narrativeMarkersSection}
!___ END-CACHE ___!

!___ CACHE:artifacts ___!
# Phase Names (use exactly as shown)
{phaseNamesList}

# Transition IDs (use exactly as shown)
{transitionIdsList}

# Transitions Artifact
<transitions>
{transitionsArtifact}
</transitions>

# State Schema
<schema>
{stateSchema}
</schema>
!___ END-CACHE ___!

{validationFeedback}
`;

// Executor uses same prompt as full version - it doesn't change
export { executeInstructionsTemplate } from "../extract-instructions/prompts.js";