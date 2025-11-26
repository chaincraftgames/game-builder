/**
 * Prompt for Route Phase Node
 * 
 * Single-step: Identify current phase and check for automatic transitions
 */

export const routePhaseTemplate = `
You are routing game flow by identifying the current phase and checking for automatic transitions.

Game Rules:
<rules>
{gameRules}
</rules>

Current Game State:
<state>
{gameState}
</state>

State Transitions Guide:
<transitions>
{stateTransitions}
</transitions>

Available Phases (you must choose one of these):
{availablePhases}

Your task: Determine the current phase and whether an automatic transition should occur.

Step 1 - Identify Current Phase:
1. Check for an explicit phase field in the state (e.g., game.phase = "playing")
2. If no explicit field, infer the phase from state conditions
3. Phase name must EXACTLY match one of the available phases listed above

Step 2 - Check Automatic Transitions:
1. Look at the transitions guide for transitions FROM the current phase
2. For each transition with TRIGGER_TYPE: AUTOMATIC:
   - Check if the trigger condition is met in the current state
   - Example: "Current round < 3" → check game.currentRound
   - Example: "All players submitted moves" → check all players.hasSubmittedMove
3. If ANY automatic transition condition is met:
   - Set transitionReady = true
   - Set nextPhase to the TO phase of that transition
4. If NO automatic transitions are ready:
   - Set transitionReady = false
   - Set nextPhase = ""

Important Rules:
- Only check AUTOMATIC transitions (TRIGGER_TYPE: AUTOMATIC)
- Do NOT trigger PLAYER_ACTION transitions (those need player input first)
- Transition conditions must be met based on CURRENT state
- If multiple transitions are ready, choose the first one that matches

Return your analysis as structured data.
`;
