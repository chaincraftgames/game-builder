/**
 * Prompts for Instructions Extraction
 */

import { INSTRUCTIONS_DOMAIN_KNOWLEDGE } from '#chaincraft/ai/simulate/domain-knowledge/instructions-domain-knowledge.js';

export const planInstructionsTemplate = `
!___ CACHE:universal-instructions ___!
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

/**
 * Executor prompt: Generates concrete templated instructions from planner hints
 */
export const executeInstructionsTemplate = `
!___ CACHE:universal-executor ___!
# Executor Output Schema
{executorSchemaJson}

# Your Task

You are generating executable game instructions from high-level hints.

Your task: Convert the planner's instruction hints into concrete, 
templated instructions that the game runtime can execute.

${INSTRUCTIONS_DOMAIN_KNOWLEDGE}
!___ END-CACHE ___!

!___ CACHE:design-executor ___!
# Game Specification Context
{gameSpecificationSummary}

# Narrative Markers Available
{narrativeMarkersSection}

**Narrative Markers:**
If planner hints include !___ NARRATIVE:MARKER_NAME ___! references, preserve them in mechanicsGuidance.
Runtime expands them before LLM invocation. Use for narrative/atmospheric content, not mechanical operations.
!___ END-CACHE ___!

!___ CACHE:artifacts-executor ___!
# ⚠️ USE THESE EXACT PHASE NAMES - DO NOT MODIFY ⚠️

{phaseNamesList}

# ⚠️ USE THESE EXACT TRANSITION IDs - DO NOT MODIFY ⚠️

{transitionIdsList}

# CRITICAL ID MATCHING REQUIREMENTS

Your instructions[].phase field must EXACTLY match a phase name from the list above.
Your automaticTransitions[].id field must EXACTLY match a transition ID from the list above.

DO NOT create variations. COPY THE EXACT STRINGS INCLUDING CAPITALIZATION.

# State Schema
{stateSchema}

# Planner Hints
{plannerHints}
!___ END-CACHE ___!

{validationFeedback}

# ⚠️ FINAL REMINDER - EXACT ID MATCHING ⚠️

Before outputting, verify:
✓ Every phase name in your output is FROM THE PHASE LIST ABOVE
✓ Every transition ID in your output is FROM THE TRANSITION ID LIST ABOVE
✓ You copied them EXACTLY (same capitalization, underscores, hyphens)

If the phase list has "choicePhase", use "choicePhase" NOT "choice_phase".
If the ID list has "both_players_submitted", use "both_players_submitted" NOT "both-submitted".

Now generate the complete instructions artifact.
`;
