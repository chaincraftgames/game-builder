/**
 * Prompts for Schema Extraction Node
 */

/**
 * Planner prompt - Analyzes game specification to understand state structure
 */
export const planSchemaTemplate = `
You are a game design expert analyzing requirements for a text-based game.
Your task is to perform a thorough analysis to determine:
1. The game rules and how to play
2. The state structure needed to track the game
3. The schema definition for that state

Review the following detailed specification for a game:
<game_specification>
{gameSpecification}
</game_specification>

You are provided with a formal schema definition for the game state, generated from a Zod schema:
<schema>
{schema}
</schema>

Use the provided schema as a base. Add any required fields for game state and runtime (such as gameEnded, publicMessage, player action flags, etc.) to ensure reliable gameplay. Return an updated schema reflecting all necessary fields.

Perform your analysis of the game description and the provided schema to understand the state structure. Conduct your analysis inside a <game_analysis> tag.

<game_analysis>
- Identify core game state (game-level fields)
- Identify player-specific state (per-player fields)
- Identify required runtime fields
- Map fields to game vs player level
- Note any additional fields or extensions present in the schema
</game_analysis>

After your analysis, provide a clear description of:
1. The game rules (how to play, phases, win conditions, etc.)
2. The complete state structure with all fields and their types
3. Which fields go at game level vs player level
`;

/**
 * Executor prompt - Generates formal schema definition and example state
 */
export const executeSchemaTemplate = `
Based on the following analysis of a game specification and the provided schema, generate the formal game rules description, state schema, and example state.

<analysis>
{plannerAnalysis}
</analysis>

Game specification for reference:
<game_specification>
{gameSpecification}
</game_specification>

Formal schema definition for the game state (from Zod):
<schema>
{schema}
</schema>

Use the provided schema as a base. Add any required fields for game state and runtime (such as gameEnded, publicMessage, player action flags, etc.) to ensure reliable gameplay. Return an updated schema reflecting all necessary fields.

You MUST generate a JSON response with exactly THREE required fields:

FIELD 1 - gameRules (string, REQUIRED):
A clear description of the game rules (how to play, phases, win conditions, etc.)

FIELD 2 - state (object, REQUIRED):
An example of the initial game state structure with "game" and "players" objects, matching the updated schema exactly.

FIELD 3 - stateSchema (object, REQUIRED):
A formal schema definition with a "fields" array containing game and players schema definitions, matching the updated schema exactly.

The 'stateSchema' object MUST have the exact shape (literal JSON example follows):

{{
	"fields": [
		{{ "name": "game", "type": "object", "required": true, "items": {{ "type": "object", "properties": {{ /* game properties */ }} }} }},
		{{ "name": "players", "type": "object", "required": true, "items": {{ "type": "object", "properties": {{ /* player properties */ }} }} }}
	]
}}

CRITICAL RULES:
- The 'fields' array MUST include both 'game' and 'players' entries (exactly these two top-level names).
- Each entry must include 'name', 'type', 'required', and 'items' as shown above.
- 'items.properties' must list property objects with 'name', 'type', and 'required' booleans.
- If you extended the provided schema, reflect those extensions in the 'fields' array.
 -Each entry must include 'name', 'type', 'required', and 'items' as shown above.
 -'items.properties' MUST be an object mapping property names to property definitions (NOT an array).
	 Each property definition must be an object with 'name', 'type', and 'required' booleans.
	 Example (literal):
	 {{ "properties": {{ "gameEnded": {{ "name": "gameEnded", "type": "boolean", "required": true }} }} }}
 -If you extended the provided schema, reflect those extensions in the 'fields' array.

**CRITICAL**: Your response must be ONLY valid JSON with the three fields (gameRules, state, stateSchema). Do not include any explanatory text, XML tags, or markdown.
`;
