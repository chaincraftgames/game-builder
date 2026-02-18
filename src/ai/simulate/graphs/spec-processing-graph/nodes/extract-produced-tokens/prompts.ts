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

# Examples

## Example 1: Character-Based Game
Spec: "players create characters with name, class, and level that can be minted as NFTs"
Fields: name, class, level, health, ready

Output:
{{
  "tokens": [
    {{
      "tokenType": "character",
      "description": "Player character with class and progression",
      "tokenSource": "player",
      "fields": ["name", "class", "level"]
    }}
  ]
}}

## Example 2: No Token Game
Spec: "3-player Rock-Paper-Scissors tournament"
Fields: currentMove, score, ready

Output:
{{ "tokens": [] }}

## Example 3: Multiple Token Types
Spec: "players build characters and can mint achievement NFTs when they complete dungeons"
Fields (player): name, class, level, ready
Fields (game): dungeonName, completionDate

Output:
{{
  "tokens": [
    {{
      "tokenType": "character",
      "description": "Player character",
      "tokenSource": "player",
      "fields": ["name", "class", "level"]
    }},
    {{
      "tokenType": "achievement",
      "description": "Dungeon completion achievement",
      "tokenSource": "game",
      "fields": ["dungeonName", "completionDate"]
    }}
  ]
}}
`;
