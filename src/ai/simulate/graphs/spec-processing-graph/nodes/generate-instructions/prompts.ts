/**
 * Prompts for Instruction Generation Node
 * 
 * Generates phase-specific instruction sets for runtime AI agent.
 */

export const planInstructionsTemplate = `
You are analyzing a game to determine what instructions the runtime AI agent needs for each phase.

Game Rules:
<rules>
{gameRules}
</rules>

State Schema:
<schema>
{stateSchema}
</schema>

Phase Transitions:
<transitions>
{stateTransitions}
</transitions>

Your task: For each phase identified in the transitions, determine what the runtime AI agent needs to know to correctly process player actions and update state.

Consider for each phase:
1. ALLOWED ACTIONS: What can players do in this phase?
2. STATE VALIDATION: What state checks must be performed?
3. STATE UPDATES: What fields typically change in this phase?
4. TRANSITION CONDITIONS: When does this phase end and move to the next?
5. EDGE CASES: What special situations must be handled?
6. GLOBAL RULES: What game rules apply regardless of phase?

Analyze each phase and describe:
- The phase's purpose and player interactions
- What the AI agent needs to validate before accepting actions
- What state changes are expected
- What conditions trigger phase transitions
- Any phase-specific edge cases or special logic

Your analysis:
`;

export const executeInstructionsTemplate = `
You are generating phase-specific instructions for a runtime AI agent that will process player actions and update game state.

Game Rules:
<rules>
{gameRules}
</rules>

State Schema:
<schema>
{stateSchema}
</schema>

Phase Transitions:
<transitions>
{stateTransitions}
</transitions>

Your task: Generate comprehensive instructions for the runtime AI agent for EVERY phase in the game.

CRITICAL INSTRUCTIONS:
1. Read the "GAME PHASES:" section in the transitions above - generate instructions for EVERY phase listed
2. Read the "PHASE TRANSITIONS:" section - generate instructions for EVERY phase mentioned (both FROM and TO)
3. ALWAYS include "setup" phase even if not mentioned in transitions (it's the initialization phase)
4. You must generate exactly one <phase name="..."> block for each phase
5. Do not skip any phases

Each instruction set should be 150-300 tokens total. Be concise and actionable.

Include:

1. PHASE OVERVIEW (20-30 tokens)
   - Purpose and what happens in this phase

2. PLAYER ACTIONS (40-80 tokens, or "No player actions" for automatic phases)
   - Valid actions and how to validate input
   - What makes an action illegal

3. STATE UPDATES (40-80 tokens)
   - Key fields to update
   - Calculations or side effects

4. PHASE TRANSITIONS (30-50 tokens)
   - Condition to move to next phase
   - What to set when transitioning

5. MESSAGES (20-40 tokens)
   - Key messages for players

CRITICAL REQUIREMENTS:
- Be concise - focus on actionable instructions only
- Use specific field names from the schema
- Use bullet points, avoid prose
- Each phase should be 150-300 tokens maximum

PHASE TYPE GUIDELINES:

For AUTOMATIC/SYSTEM phases (like "setup", "scoring", "finished"):
- These phases perform automatic calculations without player input
- Focus sections: PHASE OVERVIEW, STATE UPDATES, PHASE TRANSITIONS
- Skip or minimize: PLAYER ACTIONS section (note "no player actions in this phase")
- Explain what calculations/updates happen automatically
- Example: "scoring" phase calculates final scores and determines winner automatically

For PLAYER ACTION phases (like "playing", "submitting", etc.):
- These phases accept and process player input
- Include all 5 sections (overview, actions, updates, transitions, messages)
- Focus on action validation and player input handling
- Specify exactly what inputs are valid and what makes them illegal
- Detail how to parse and process player input

Output format: XML with <phase> tags, where each phase's name is in the "name" attribute.

Example structure (use actual phase names from transitions, PLUS "setup"):
<instructions>
  <phase name="setup">
PHASE OVERVIEW:
Initial game setup when players join...

STATE UPDATES:
- Initialize game.currentRound = 1...
- Set all players.*.actionsAllowed = true...
- Set game.publicMessage = welcome message...

PHASE TRANSITIONS:
- Immediately transition to "playing" phase...
  </phase>
  
  <phase name="playing">
PHASE OVERVIEW:
Players submit moves...

PLAYER ACTIONS:
- Accept move submissions...
- Validate input...
  </phase>
  
  <phase name="scoring">
PHASE OVERVIEW:
Calculate round results...

STATE UPDATES:
- Update players.*.totalScore...
  </phase>
</instructions>

Generate instructions for ALL phases including "setup" (mandatory) plus all phases from transitions.
Output ONLY the XML - no explanation or markdown formatting.
`;
