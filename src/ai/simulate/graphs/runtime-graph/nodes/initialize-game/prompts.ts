// Initialization prompt for game state setup

export const runtimeInitializeTemplate = `
You are an AI simulation expert tasked with initializing a text-based game simulation.
You will set up the initial game state and provide welcome messages and initial instructions 
to all players.

The specification of the game is as follows:
<game_specification>
{gameRules}
</game_specification>

The players participating in the game are:
<players>
{players}
</players>

Phase-specific initialization instructions:
<setup_instructions>
{setupInstructions}
</setup_instructions>

Important State Conventions:

Follow the setup instructions above to properly initialize the game state. Conduct your analysis 
inside a <game_analysis> tag.

<game_analysis>
1. Review the setup instructions and identify all required initial values for game and player state
2. List out starting values for each player and the game state according to the setup instructions
3. Compose a public message that should be broadcast to all players:
    - Welcome messages
    - The starting game state
    - Initial instructions and the actions that are valid for the players to take
    - Any input needed from the players to start the game
4. Leave the privateMessage field empty unless the setup instructions specifically require it
</game_analysis>

**CRITICAL - REQUIRED STRUCTURE**:
Your response MUST be a JSON object with EXACTLY TWO top-level fields. This is NOT optional:

1. "game" (REQUIRED) - An object containing all game-level state fields
   - Must include: gameEnded (boolean), publicMessage (string)
   - Plus all game-specific fields from the schema

2. "players" (REQUIRED) - An object with one entry for EACH player ID listed above
   - Keys MUST be the exact player IDs provided
   - Each player object MUST include: illegalActionCount (number), privateMessage (string), 
     actionsAllowed (boolean), actionRequired (boolean)
   - Plus all player-specific fields from the schema

Example structure for players ["alice", "bob"] (literal JSON example):
{{
  "game": {{
    "gameEnded": false,
    "publicMessage": "Welcome message...",
    /* ...other game fields... */
  }},
  "players": {{
    "alice": {{
      "illegalActionCount": 0,
      "privateMessage": "",
      "actionsAllowed": true,
      "actionRequired": true,
      /* ...other player fields... */
    }},
    "bob": {{
      "illegalActionCount": 0,
      "privateMessage": "",
      "actionsAllowed": true,
      "actionRequired": true,
      /* ...other player fields... */
    }}
  }}
}}

DO NOT generate only the "game" field. You MUST generate BOTH "game" AND "players" fields.

Based on the analysis and setup instructions, initialize the game state and provide welcome messages 
as a JSON object matching the provided schema.
`