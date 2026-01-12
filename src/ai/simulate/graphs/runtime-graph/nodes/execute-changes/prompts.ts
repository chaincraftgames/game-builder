/**
 * Prompt for Execute Changes Node
 * 
 * LLM resolves template variables and computes mechanics, returns stateDelta operations.
 * The runtime applies these operations to maintain complete, consistent state.
 */

export const executeChangesTemplate = `
!___ CACHE:universal-execute ___!
You are resolving template variables and computing game mechanics to produce state delta operations.

# Your Task

The instructions contain stateDelta operations with template variables like {{playerId}}, {{input.move}}, {{winnerId}}, etc.

Your job is to:
1. Resolve ALL template variables to literal values
2. Apply mechanicsGuidance rules if present (determine winners, compute scores, etc.)
3. Return the RESOLVED stateDelta operations as an array

**YOU DO NOT RETURN THE UPDATED STATE**. You only return the state delta operations with all templates resolved.

**NOTE ON RNG**: Any RNG operations have been PRE-RESOLVED by the router. Template variables like {{randomValue}} already contain concrete values.

# How to Resolve Templates

## 1. Deterministic Operations (NO templates)

If operations have NO templates, return them as-is:
{{ "op": "set", "path": "game.round", "value": 1 }}

## 2. Player Actions

When playerAction is provided:
- {{{{playerId}}}} → playerAction.playerId
- {{{{input.*}}}} → from playerAction.playerAction string

Example:
playerAction = {{"playerId": "p1", "playerAction": "rock"}}
Template: {{"op": "set", "path": "players.{{{{playerId}}}}.currentMove", "value": "{{{{input.move}}}}"}}
Resolved: {{"op": "set", "path": "players.p1.currentMove", "value": "rock"}}

## 3. Mechanics Computation

When mechanicsGuidance is present:
1. Apply the rules to current state
2. Compute template variables ({{{{winnerId}}}}, {{{{score}}}}, {{{{outcome}}}})
3. Resolve templates in stateDelta

Example:
mechanicsGuidance: {{"rules": ["Rock beats scissors"]}}
Current state: p1.currentMove="rock", p2.currentMove="scissors"
Compute: winnerId="p1", outcome="Rock beats scissors"
Template: {{"op": "increment", "path": "players.{{{{winnerId}}}}.score", "value": 1}}
Resolved: {{"op": "increment", "path": "players.p1.score", "value": 1}}

## 4. Message Templates

Resolve message templates the same way:
- Public message: Replace {{{{game.roundNumber}}}}, {{{{p1Name}}}}, etc.
- Private messages: Key is playerId, value is resolved message text

# Output Format

Return JSON object with these fields:

{{
  "rationale": "Brief explanation of what you computed",
  "stateDelta": [/* Array of resolved stateDelta operations */],
  "publicMessage": "Resolved public message if instructions specify one",
  "privateMessages": {{
    "p1": "Resolved private message for p1 if instructions specify one"
  }}
}}

**CRITICAL**: ALL template variables {{{{...}}}} must be resolved to literal values. The runtime cannot process templates - it only applies the resolved operations.
!___ END-CACHE ___!

!___ CACHE:phase-instructions ___!
Instructions:
<instructions>
{selectedInstructions}
</instructions>
!___ END-CACHE ___!

Player IDs:
<players>
{players}
</players>

Player Action (if present):
<playerAction>
{playerAction}
</playerAction>

Current State:
<state>
{gameState}
</state>

# Your Task Now

Based on the instructions, current state, and player action above:

1. **Resolve ALL template variables** ({{{{playerId}}}}, {{{{input.*}}}}, {{{{winnerId}}}}, etc.) to concrete literal values
2. **Apply mechanicsGuidance rules** if present to determine outcomes, winners, scores, etc.
3. **Return resolved stateDelta operations** with all templates replaced by literal values
4. **Generate messages** using narrative guidance if provided (markers are already expanded)

Output valid JSON with: rationale, stateDelta array, publicMessage (if specified), and privateMessages (if specified).
`;
