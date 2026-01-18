/**
 * Prompts for Schema Extraction Node
 */

/**
 * Planner prompt - Analyzes game specification to understand state structure
 */
export const planSchemaTemplate = `
!___ CACHE:universal-planner ___!
You are a game design analyst planning the game state schema for a turn based game. 
Using the provided game specification and the base schema, produce exactly two sections 
only (no extra commentary):

1) Natural summary (1–3 short sentences): a concise plain-English summary of the 
minimal state the runtime must capture to run the game (keep it focused on 
decision-relevant state).

2) Fields: a compact JSON array describing any new fields required 
beyond the provided base schema. Each field entry must be an object with the following keys:
   - "name" (string): dot-path (example: "players.<id>.currentMove")
   - "type" (string): one of "number|string|boolean|enum|object|array|record"
   - "path" (string): either "game" or "player" indicating wether the field is at the
     game-level or player-level
   - "source" (string): either "system" (set by system), "player input" (input from players),
   - "purpose" (string): one short phrase (<=10 words) explaining why it is required
   - "constraints" (optional string): e.g. "enum:[rock,paper,scissors]" or "maxItems:3"

Rules for the planner output:
- Do NOT output full JSON schemas or example state objects
- Do not include histories unless explicitly required by the game spec.  Prefer cumulative
  updates to current state fields.
- Do NOT add "players.<id>.ready" or player-join tracking fields unless the 
  specification explicitly states players can join after the game starts.
- Keep the field list to at most 6 entries. If no new fields are required, return an 
  empty array "[]".
- The Natural summary may be plain text (1–3 sentences). The Fields section MUST be valid 
  JSON parseable by the executor.
- ⚠️ CRITICAL: Keep state structure FLAT. Only one level of properties under "game" and 
  under "players". Do NOT create nested objects like game.settings.difficulty or 
  players.<id>.inventory.gold. Use simple flat fields: game.difficulty, players.<id>.gold.
- ⚠️ RANDOMNESS STORAGE: If the game specification mentions dice rolls, card draws, 
  shuffling, random events, or any non-deterministic outcomes, add fields to store the 
  random results. Examples: game.lastDiceRoll, game.monsterAttackRoll, game.deadlyScenario. 
  These fields allow random values to be generated once and referenced deterministically in 
  game logic.
- ⚠️ CRITICAL: USE STANDARD PLAYER STATE FIELDS - The base schema provides "actionRequired" 
  (boolean) to indicate whether a player must take an action for the game to progress. 
  DO NOT create custom fields like "hasSubmitted", "hasMoved", "turnComplete", "choiceMade", 
  etc. to track whether a player has completed their action. ALWAYS use the standard 
  "actionRequired" field for this purpose. When a player completes their action (submits a 
  choice, makes a move, etc.), the game logic will set actionRequired=false. This ensures 
  the router can reliably determine when all players have acted and automatic transitions 
  can proceed.
- ⚠️ CRITICAL: USE STANDARD PLAYER STATE FIELDS - The base schema provides standard fields 
  for tracking player actions: "actionRequired" (boolean) indicates whether a player must 
  take an action for the game to progress. DO NOT create custom fields like "hasSubmitted", 
  "hasMoved", "turnComplete", "choiceMade", etc. to track whether a player has taken their 
  action. ALWAYS use "actionRequired" for this purpose. When a player completes their action 
  (submits a choice, makes a move, etc.), the game logic should set actionRequired=false. 
  This ensures the router can reliably determine when all players have acted and automatic 
  transitions can proceed.  

You are provided with a formal schema definition for the base game state.  The final schema
must match the shape of this schema:
<schema>
{schema}
</schema>

Output format (exactly):

Natural summary:
"<one to three short sentences>"

Fields:
\`\`\`json
<JSON array as described above>
\`\`\`

Example (exact formatting expected):
Natural summary:
"Game has 3 rounds. Each round all players submit one move; rounds resolve when all 
moves are in. Scores updated per head-to-head matches."

Fields:
\`\`\`json
[
  {{"name":"currentPhase","type":"string","purpose":"Track current game phase",
    "path": "game","source":"system"}}, 
  {{"name":"Choice","type":"enum","purpose":"player selection",
    "path":"player","source":"player","constraints":"enum:[rock,paper,scissors]"}}
]
\`\`\`
!___ END-CACHE ___!

!___ CACHE:design-planner ___!
Review the following detailed specification for a game:
<game_specification>
{gameSpecification}
</game_specification>
!___ END-CACHE ___!

Now analyze the specification and produce your output following the format specified above (Natural summary and Fields array).
`;

/**
 * Executor prompt - Generates formal schema definition and example state
 */
export const executeSchemaTemplate = `
!___ CACHE:universal-executor ___!
You are generating the formal game state schema, rules, and example state.

You MUST generate a JSON response with exactly THREE required fields:

FIELD 1 - gameRules (string, REQUIRED):
A clear description of the game rules (how to play, phases, win conditions, etc.)

FIELD 2 - state (object, REQUIRED):
An example of the initial game state structure with "game" and "players" objects, 
matching the updated schema exactly.

FIELD 3 - stateSchema (object, REQUIRED):
A JSON Schema object defining the complete game state structure. This should be a 
standard JSON Schema (Draft 7) that extends the base schema with game-specific fields.

The 'stateSchema' MUST be a valid JSON Schema object with this structure:

{{
  "type": "object",
  "properties": {{
    "game": {{
      "type": "object",
      "required": ["gameEnded", "publicMessage", /* other required game fields */],
      "properties": {{
        "gameEnded": {{ "type": "boolean", "description": "Whether the game has ended" }},
        "publicMessage": {{ "type": "string", "description": "Message visible to all players" }},
        /* Add game-specific fields here */
      }}
    }},
    "players": {{
      "type": "object",
      "additionalProperties": {{
        "type": "object",
        "required": ["ready", /* other required player fields */],
        "properties": {{
          "ready": {{ "type": "boolean", "description": "Whether player is ready" }},
          /* Add player-specific fields here */
        }}
      }}
    }}
  }},
  "required": ["game", "players"]
}}

CRITICAL RULES:
- Use standard JSON Schema syntax (type, properties, required, additionalProperties, items, enum, description)
- Include ALL fields from the base schema PLUS game-specific fields identified in the planner analysis
- For fixed objects (like "game"), use "properties" to define fields
- For records/maps (like "players"), use "additionalProperties" since keys are dynamic player IDs
- For arrays, use "items" to define the schema of array elements
- Use "required" arrays to specify which fields are mandatory
- Include "description" for all game-specific fields you add
- Keep it simple: use object, array, string, number, boolean, integer types and enum for constrained strings
- ⚠️ CRITICAL: Keep structure FLAT - only ONE level of properties under "game" and under 
  "players". Do NOT nest objects. Example: use "difficulty" directly under game.properties, 
  NOT "settings.properties.difficulty". All player fields go directly under 
  players.additionalProperties.properties, NOT nested inside other objects.

Example game-specific additions:
- Game phase tracking: {{ "currentPhase": {{ "type": "string", "description": "Current game phase - valid values defined by transitions artifact" }} }}
- Round counter: {{ "round": {{ "type": "number" }} }}
- Player choices: {{ "choice": {{ "type": "string", "enum": ["rock", "paper", "scissors"] }} }}
- Player scores: {{ "score": {{ "type": "number" }} }}

IMPORTANT: Do NOT use enum for phase/currentPhase fields. Phases are defined in the transitions artifact which is generated AFTER the schema. The currentPhase field should be a plain string type.

⚠️ CRITICAL: You MUST add ALL fields from the planner analysis to the stateSchema.

For EACH field in the planner's "Fields" array:
- If path="game": add to stateSchema.properties.game.properties[fieldName]
- If path="player": add to stateSchema.properties.players.additionalProperties.properties[fieldName]

DO NOT skip any fields. If the planner identified a field as required, you MUST include it 
in the schema. Dropping fields will cause validation failures later.

Base schema definition for the game state (from Zod):
<schema>
{schema}
</schema>

Use the provided schema as a base. Add the planner's fields PLUS any additional runtime fields 
(such as gameEnded, publicMessage, player action flags, etc.) to ensure reliable gameplay.
!___ END-CACHE ___!

!___ CACHE:artifacts-executor ___!
Planner analysis of game requirements:
<analysis>
{plannerAnalysis}
</analysis>
!___ END-CACHE ___!

Now generate the complete schema artifact (gameRules, state, stateSchema) based on the planner analysis and base schema.

**CRITICAL**: Your response must be ONLY valid JSON with the three fields (gameRules, 
state, stateSchema). Do not include any explanatory text, XML tags, or markdown.
`;
