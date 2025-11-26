/**
 * Prompts for State Transitions Extraction
 * 
 * Generates structured phase transition guide for runtime AI agent.
 */

export const planTransitionsTemplate = `
You are analyzing a game specification to identify phases and state transitions.

Game Rules:
<rules>
{gameRules}
</rules>

State Schema:
<schema>
{stateSchema}
</schema>

Your task: Analyze the game to identify all distinct phases and the logic for transitioning between them.

Consider:
1. EXPLICIT PHASES: Does the game mention phases like "setup", "playing", "scoring", "finished"?
2. IMPLICIT PHASES: Are there distinct stages in gameplay (e.g., "waiting for players", "active round", "between rounds")?
3. PHASE INDICATORS: What state fields indicate the current phase? (commonly game.phase, game.gameEnded, game.currentRound)
4. TRANSITION TRIGGERS: What causes phase changes?
   - Player actions (first move, all players ready)
   - State conditions (round complete, score threshold reached)
   - Time/sequence (after N rounds, end of turn)
   - Game events (winner determined, tie detected)

Think through the game flow step by step. What are the distinct states the game moves through from start to finish?

For each phase, also determine:
- Does this phase require player input to proceed? (e.g., waiting for player moves)
- Or is it AI-only processing? (e.g., calculating scores, transitioning automatically)

Your analysis (natural language, be thorough):
`;

export const executeTransitionsTemplate = `
You are creating a phase transition guide for a game simulation system.

Game Rules:
<rules>
{gameRules}
</rules>

State Schema Fields:
<schema>
{stateSchema}
</schema>

Your task: Analyze the game and generate a clear, structured description of game phases and transitions that will guide an AI agent in detecting and executing phase changes.

Format your output as follows:

GAME PHASES:
[List each distinct phase with a brief description]

PHASE TRANSITIONS:

FROM: [phase name]
TO: [next phase name]
TRIGGER_TYPE: [PLAYER_ACTION or AUTOMATIC]
  - PLAYER_ACTION: This transition only occurs after player input (e.g., all players submit moves)
  - AUTOMATIC: This transition occurs automatically when conditions are met (e.g., after scoring completes)
TRIGGER: [What causes this transition - be specific about state conditions]
STATE CHECKS: [What fields to examine - reference schema fields like game.currentRound, game.gameEnded]
SIDE EFFECTS: [What else changes during this transition - e.g., reset counters, clear temporary state]

[Repeat for each transition]

SPECIAL CASES:
[Any conditional logic, alternate paths, or edge cases]

CRITICAL REQUIREMENTS:
- Be explicit about which state fields control phase flow
- Reference actual field names from the schema (e.g., game.phase, game.roundMoves)
- Describe conditions clearly enough for an AI to evaluate them
- Include both forward transitions (normal flow) and any backward/branch transitions
- Note when game.gameEnded should be set to true
- Specify phase-specific validation rules
- Clearly mark each transition's TRIGGER_TYPE (PLAYER_ACTION vs AUTOMATIC) to guide runtime flow control

`;
