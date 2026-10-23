/**
 * Prompt templates for produced tokens extraction
 */

export const extractProducedTokensTemplate = `
!___ CACHE:design-planner ___!
You are analyzing a game specification to determine which tokens this game should produce.

# Game Specification
{gameSpecification}
!___ END-CACHE ___!

# Available State Fields
{stateFields}

# Player Phases
{playerPhases}

# Output Schema
Your response must conform to this JSON schema:
<schema>
{outputSchema}
</schema>

# Task
Analyze the game specification and return a JSON object containing produced token configurations.

## Guidelines

1. **When to Create Token Configuration:**
   - Only if NFT or Token creation is explicitly mentioned in the specification (e.g. "players can mint an NFT of their character")
   - If no token creation is mentioned, return: {{ "tokens": [] }}

2. **What to Include in Tokens:**
   - Only include fields that:
     * Are meaningful identifiers or attributes
     * Represent permanent characteristics
     * Would be valuable on their own
   - Exclude:
     * Temporary state (actionRequired, ready, waiting)
     * System fields (playerId, timestamp)
     * Ephemeral game state (currentTurn, lastAction)

3. **Token Source:**
   - Use "game" for shared/global assets (rare items, global achievements)
   - Use "player" for player-specific assets (characters, personal items, player achievements)

4. **Field Validation:**
   - Only reference fields that exist in the state schema
   - For "game" source, use fields from game state (without "game." prefix)
   - For "player" source, use fields from player state (without "players.*." prefix)

5. **actionId:**
   - Set \`actionId\` to a descriptive kebab-case identifier for the action context that populates this token's data (e.g., "describe-character", "create-loadout")
   - This labels the token for consumption filtering and future schema evolution
   - Omit \`actionId\` only for tokens that will never be consumed as input (pure trophies/achievements)

6. **consumableIn (Item Consumption):**
   - If the game has a player phase where the token's data could substitute for typed player input, set \`consumableIn\`
   - \`consumableIn.phase\` must be an existing player phase name from the Player Phases list above
   - \`consumableIn.actionField\` is an array of field names from the token's \`fields\`. At consumption time, the first present field is used as the action string. Use a single-element array for simple cases; multiple entries provide fallback for schema evolution.
   - Example: A character token with field "characterDescription" that was created during a "describe_character" phase can be consumed in that same phase — set \`consumableIn: {{ "phase": "describe_character", "actionField": ["characterDescription"] }}\`
   - Omit \`consumableIn\` for tokens that are purely collectible (trophies, achievements) and not reusable as game input

# Examples

## Example 1: Character-Based Game with Consumption
Spec: "players create characters with name, class, and level that can be minted as NFTs and reused in future matches"
Fields: name, class, level, health, ready
Player Phases: describe_character, choose_action

Output:
{{
  "tokens": [
    {{
      "tokenType": "character",
      "description": "Player character with class and progression",
      "tokenSource": "player",
      "fields": ["name", "class", "level"],
      "actionId": "describe-character",
      "consumableIn": {{
        "phase": "describe_character",
        "actionField": ["name"]
      }}
    }}
  ]
}}

## Example 2: No Token Game
Spec: "3-player Rock-Paper-Scissors tournament"
Fields: currentMove, score, ready

Output:
{{ "tokens": [] }}

## Example 3: Achievement Token (No Consumption)
Spec: "players complete dungeons and can mint achievement NFTs"
Fields (player): name, class, level, ready
Fields (game): dungeonName, completionDate

Output:
{{
  "tokens": [
    {{
      "tokenType": "achievement",
      "description": "Dungeon completion achievement",
      "tokenSource": "game",
      "fields": ["dungeonName", "completionDate"]
    }}
  ]
}}
`;
