/**
 * Prompts for Schema Extraction Node
 */

/**
 * Schema executor prompt - Analyzes game specification and extracts state fields
 */
export const executeSchemaTemplate = `
!___ CACHE:universal-planner ___!
You are a game design analyst planning the game state schema for a turn-based game.

# Architecture: Who Writes What

This game engine separates concerns clearly. Understanding the separation is CRITICAL
to designing the right fields:

## Player Action Phases (requiresPlayerInput: true)
- Players submit free-text input ("I bid three 5s", "I play Fireball")
- The runtime parses the input, validates it, and sets state fields
- Player action phases do NOT compute game outcomes — they ONLY record what the player chose
- Fields set here are called **player input fields**

## Automatic Transitions (requiresPlayerInput: false)
- The engine reads the state fields that player actions set, then computes what happens
- This is where game rules live: challenge resolution, scoring, win determination, etc.
- Fields set here are called **game outcome fields**

## Router (system-controlled)
- Manages currentPhase and gameEnded exclusively — these are already in the base schema
- Phase changes fire automatically when preconditions on state fields are met

## Design Principle: Input Fields Enable Transition Preconditions
The router checks state field values to decide when to change phases.
If a game event (e.g., "player declares a challenge") should trigger a phase change,
there MUST be a state field the router can check (e.g., challengerId is not null).
Without that field, no transition can fire and the game deadlocks.

When designing fields, ask: "What state does the router need to see to know when
to move to the next phase?" Every phase transition needs at least one writable
field whose value changes to satisfy the transition's precondition.

# Your Task

Using the game specification and base schema, produce exactly two sections:

1) **Natural summary** (1–3 short sentences): a concise plain-English summary of the
minimal state the runtime must capture, organized by who writes it.

2) **Fields**: a compact JSON array describing any new fields required beyond the base schema.
Each field entry must have these keys:
   - "name" (string): dot-path (example: "players.*.currentMove" or "game.round")
   - "type" (string): MUST be one of: "string" | "number" | "boolean" | "enum" | "array" | "record" | "object"
   - "path" (string): either "game" or "player"
   - "purpose" (string): one short phrase (<=10 words) explaining why it is required
   - "enumValues" (optional string[]): list of allowed values when "type" or "valueType" is "enum"
   - "valueType" (optional string): inner element/value type when "type" is "array" or "record"
   - "fields" (optional array): sub-field definitions when "type" is "object" OR when "type" is "array"
     and "valueType" is "object" (i.e., an array of structured objects). Each sub-field has the same
     shape but CANNOT itself be type "object" (max 1 level of nesting).
     ⚠️ REQUIRED when "valueType" is "object" — omitting "fields" for a structured array produces an
     untyped "unknown[]" in generated code, which will cause compile errors in every mechanic that
     reads from the array. Always include "fields" whenever "valueType" is "object".
   - "required" (optional boolean): defaults to true if omitted

   ### Type Guidance
   - Simple string → {{"type":"string"}}
   - Simple number → {{"type":"number"}}
   - Boolean flag → {{"type":"boolean"}}
   - Fixed set of choices → {{"type":"enum","enumValues":["rock","paper","scissors"]}}
   - List of strings → {{"type":"array","valueType":"string"}}
   - List of numbers → {{"type":"array","valueType":"number"}}
   - List of enum values → {{"type":"array","valueType":"enum","enumValues":["rock","paper","scissors"]}}
   - List of structured objects (each element has multiple typed fields) → {{"type":"array","valueType":"object","fields":[{{"name":"id","type":"string","path":"player","purpose":"unique identifier"}},{{"name":"value","type":"number","path":"player","purpose":"numeric value"}}]}}
   - Dictionary with dynamic keys and uniform value type → {{"type":"record","valueType":"string"}}
   - Structured data with known fixed fields of different types → {{"type":"object","fields":[...]}}

   ⚠️ OBJECT vs RECORD:
   - "object": FIXED known sub-fields with DIFFERENT types (generates a typed interface)
   - "record": truly dynamic/homogeneous maps where keys are unknown at design time and ALL values are the same type
   - When in doubt, prefer "object" over "record"

# Field Design Rules

## Category 1: Game Outcome Fields
These are set by automatic transitions after a player acts. They capture WHAT HAPPENED.
- Example (RPS): roundWinner, roundOutcome
- Example (Poker): potWinnerId, handResult
- Example (Card game): damageDealt, cardsConsumed
- Example (Liar's Dice): currentBidCount, currentBidFace, currentBidderId

## ⛔ DO NOT CREATE: Player Input / Intent Fields
**Player input is captured in \`player.currentAction\` — a system-managed field.**
Do NOT define fields like:
- \`pendingBidCount\`, \`pendingBidFace\`, \`bidAttempt\` — these are player input
- \`selectedCardId\`, \`chosenMove\`, \`pendingAction\` — player input
- \`currentMove\`, \`currentBet\`, \`submittedChoice\` — player input
A separate action definitions phase manages these. If you see a pattern where a player
submits data that a mechanic reads, do NOT create a state field for it — it is handled
by \`player.currentAction\`.

## Category 2: Transition Signal Fields
These are input fields whose primary purpose is to trigger phase changes.
The router evaluates preconditions on these to decide when to transition.
- Example: game.allPlayersReady (true → transition from lobby to gameplay)
- Example: game.roundComplete (true → transition from play to scoring)
- If a game event should trigger a phase change, include a field for it.

## Mandatory Rules
- Keep the field count minimal — only add fields that are strictly necessary. If no new fields are needed, return an empty array.
- Do NOT redefine fields already in the base schema.
- game: fields are ONE level deep (✓ game.round, ✗ game.settings.difficulty)
- players: fields are ONE level deep under the player key (✓ players.*.score, ✗ players.*.inventory.gold)
  ⚠️ NOTE: This rule governs STATE PATHS, not array element structure. An array field like
  players.*.weapons is still ONE level deep. The "fields" sub-array inside an array-of-objects
  field describes what each element looks like — it does NOT create deeper state paths.
  So players.*.weapons with fields:[{{name:"id",...}},{{name:"rpsValue",...}}] is CORRECT and allowed.
- Player-specific data MUST go under players.*, NOT as game.scoreP1 / game.player1Hand
- Do NOT add history/log fields unless the spec explicitly requires viewing past state.
  Prefer cumulative updates to current fields.
- Use the standard "actionRequired" field for tracking player turn completion.
  Do NOT create custom "hasSubmitted", "hasMoved", "turnComplete" fields.
- The \`currentAction\` field on player state is managed by the action definitions system.
  Do NOT create or redefine it here.
- ⚠️ RANDOMNESS: If the game mentions dice rolls, card draws, random events, add fields
  to store the results (e.g., game.lastDiceRoll). These let random values be generated
  once and referenced deterministically.
- ⛔ NEVER add timing/elapsed-time fields (phaseElapsedMs, elapsedSeconds, timerMs, etc.).
  Phase timing is managed by the runtime engine.
- ⛔ NEVER add image URL or narrative text storage fields.
  Image generation and narrative output use runtime output channels, not state fields.

# Base Schema (already provided — do NOT redefine these)
<base_schema_fields>
{baseSchemaFields}
</base_schema_fields>

# Formal Schema Definition (your output fields must match this shape)
<schema>
{schema}
</schema>

# Output Format (exactly)

Natural summary:
"<one to three short sentences>"

Fields:
\`\`\`json
<JSON array as described above>
\`\`\`

Example:
Natural summary:
"Players submit moves (player input), then the engine resolves head-to-head matches
and updates scores (game outcome). Scores track cumulative wins across 3 rounds."

Fields:
\`\`\`json
[
  {{"name":"currentMove","type":"enum","purpose":"Player's chosen move (input)",
    "path":"player","enumValues":["rock","paper","scissors"]}},
  {{"name":"roundWinner","type":"string","purpose":"Who won the round (outcome)",
    "path":"game"}},
  {{"name":"inventory","type":"array","valueType":"object","purpose":"Items held by the player",
    "path":"player","fields":[
      {{"name":"id","type":"string","path":"player","purpose":"unique item identifier"}},
      {{"name":"name","type":"string","path":"player","purpose":"item display name"}},
      {{"name":"quantity","type":"number","path":"player","purpose":"how many the player holds"}}
    ]}}
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
