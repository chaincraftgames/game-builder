/**
 * Prompts for Plan Changes Node
 * 
 * Handles both player actions and automatic phase transitions
 */

export const planPlayerActionTemplate = `
You are planning state changes for a player action in a game.

Phase Instructions:
<instructions>
{selectedInstructions}
</instructions>

Current Game State:
<state>
{gameState}
</state>

Player Action:
Player: {playerId}
Action: {playerAction}

Your task: Analyze the action and plan the necessary state changes.

Consider:
1. ACTION VALIDITY: Is this action allowed in the current phase/state?
2. STATE UPDATES: What fields need to change? (player state, game state, counters, flags)
3. SIDE EFFECTS: Does this action trigger any game events? (scoring, round completion, etc.)
4. MESSAGES: What feedback should players receive?
5. VALIDATION: Does this action complete a round, phase, or game?

Plan the state changes in natural language. Be specific about:
- Which fields to update (use dot notation: game.currentRound, players.player1.score)
- What the new values should be
- Why each change is needed
- Any validation or error conditions

Your detailed plan:
`;

export const planPhaseTransitionTemplate = `
You are planning state changes for an automatic phase transition in a game.

Current Phase Instructions:
<currentInstructions>
{selectedInstructions}
</currentInstructions>

Current Game State:
<state>
{gameState}
</state>

Phase Transition:
From: {currentPhase}
To: {nextPhase}

Your task: Plan the state changes needed to transition from the current phase to the next phase.

Consider:
1. PHASE FIELD: Update game.phase to the new phase
2. RESET/CLEANUP: What temporary state needs to be cleared? (round moves, submission flags, etc.)
3. INITIALIZATION: What needs to be set up for the new phase? (counters, flags, defaults)
4. SIDE EFFECTS: Any calculations or updates that happen during transition? (scoring, round increment)
5. MESSAGES: What announcements should be made about the transition?
6. GAME END: Does this transition end the game? Set game.gameEnded if needed.

Plan the state changes in natural language. Be specific about:
- Which fields to update
- What the new values should be
- The order of operations if it matters
- Any calculations that need to happen

Your detailed plan:
`;
