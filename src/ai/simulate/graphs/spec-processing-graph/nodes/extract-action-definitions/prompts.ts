/**
 * Prompts for Action Definitions Extraction
 */

export const executeActionDefinitionsTemplate = `
!___ CACHE:universal-action-defs ___!
You are a game design analyst identifying all player action types for a turn-based game.

# Your Task

Analyze the game specification and identify every distinct type of action a player can take
during the game. For each action, provide:
- A stable camelCase identifier (e.g. 'bid', 'challenge', 'playCard', 'pass')
- A human-readable name
- A description of what the player is doing
- The input fields the player must provide

# Critical Rules

## What to INCLUDE in inputFields
Only include data the player EXPLICITLY CHOOSES when taking the action:
- Bid count and die face value in a bidding game
- Card ID to play in a card game
- Target player in an attack action
- Resource amount to spend in a resource game
- Move direction in a movement game
- Choice from a fixed set (enum) e.g. rock/paper/scissors

## What to EXCLUDE from inputFields
Do NOT include:
- Game state outcome fields (winners, scores, round results) — mechanics compute these
- Player state tracking fields (hand cards, score, resources held) — already in state
- System fields (actionRequired, isGameWinner, currentAction)
- Phase or turn tracking fields
- Any derived or computed value — only raw player choices

## Actions With No Input
Some actions require no data from the player — the act of taking them is sufficient:
- 'challenge' in a bidding game — player just declares challenge
- 'pass' — player skips their turn
- 'ready' — player signals they are ready
These get inputFields: []

## Action IDs
Use concise camelCase IDs that describe the action:
- 'bid' not 'placeBid' or 'submitBid'
- 'challenge' not 'declareChallenge'
- 'playCard' not 'playACard'
- 'draw' not 'drawCard'
- 'attack' not 'performAttack'

# Output Schema

<schema>
{schemaJson}
</schema>

Return EXACTLY one JSON object matching the schema above.
Do not include markdown fences. Do not include any text before or after the JSON.
!___ END-CACHE ___!

!___ CACHE:design-spec ___!
# Game Specification

<specification>
{gameSpecification}
</specification>
!___ END-CACHE ___!

Now analyze the specification and produce the ActionDefinitionsArtifact JSON.
`;
