/**
 * Prompts for Schema Extraction Node
 */

/**
 * Schema executor prompt - Analyzes game specification and extracts state fields
 */
export const executeSchemaTemplate = `
!___ CACHE:universal-planner ___!
You are a game design analyst planning the game state schema for a turn based game. 
Using the provided game specification and the base schema, produce exactly two sections 
only (no extra commentary):

1) Natural summary (1–3 short sentences): a concise plain-English summary of the 
minimal state the runtime must capture to run the game (keep it focused on 
decision-relevant state).

2) Fields: a compact JSON array describing any new fields required 
beyond the provided base schema. Each field entry must be an object with the following keys:
   - "name" (string): dot-path (example: "players.*.currentMove" or "game.round")
   - "type" (string): one of "number|string|boolean|enum|object|array|record"
   - "path" (string): either "game" or "player" indicating wether the field is at the
     game-level or player-level
   - "source" (string): either "system" (set by system), "player input" (input from players),
   - "purpose" (string): one short phrase (<=10 words) explaining why it is required
   - "constraints" (optional string): e.g. "enum:[rock,paper,scissors]" or "maxItems:3"

⚠️ IMPORTANT: BASE SCHEMA FIELDS ALREADY PROVIDED
The following fields are already available in the base schema and should NOT be redefined:
<base_schema_fields>
{baseSchemaFields}
</base_schema_fields>

Only add NEW fields that are specific to this game and not already covered by the base schema.

Rules for the planner output:
- Do NOT output full JSON schemas or example state objects
- Do not include histories unless explicitly required by the game spec.  Prefer cumulative
  updates to current state fields.
- Do NOT add "players.*.ready" or player-join tracking fields unless the 
  specification explicitly states players can join after the game starts.
- Keep the field list to at most 6 entries. If no new fields are required, return an 
  empty array "[]".
- The Natural summary may be plain text (1–3 sentences). The Fields section MUST be valid 
  JSON parseable by the executor.
- ⚠️ CRITICAL: STATE STRUCTURE RULES
  * game: Properties are ONE level deep directly under "game"
    ✓ CORRECT: game.round, game.currentPhase, game.difficulty
    ✗ INCORRECT: game.settings.difficulty (nested object)
  * players: This is a map/record where each player ID is a key, with properties ONE level 
    under that key
    ✓ CORRECT: players.*.score, players.*.hand, players.*.currentMove
    ✗ INCORRECT: players.*.inventory.gold (nested under player)
    ✗ INCORRECT: game.scoreP1, game.player1Hand (player data under game with suffixes)
  Player-specific data MUST be organized under the players map, NOT as separate fields 
  under game with player suffixes. This ensures scalability to N-player games.
- ⚠️ RANDOMNESS STORAGE: If the game specification mentions dice rolls, card draws, 
  shuffling, random events, or any non-deterministic outcomes, add fields to store the 
  random results. Examples: game.lastDiceRoll, game.monsterAttackRoll, game.deadlyScenario. 
  These fields allow random values to be generated once and referenced deterministically in 
  game logic.
- ⚠️ NO IMAGE OR NARRATIVE STORAGE FIELDS: Do NOT create fields to store generated image 
  URLs (e.g. "lastOutcomeImage", "roundImage") or narrative/narration text 
  (e.g. "lastRoundNarration", "roundStory", "outcomeDescription"). Image generation and 
  narrative output are handled entirely by the runtime through standard output channels: 
  publicMessage for narrative text and the imageContentSpec → imagePrompt pipeline for 
  images. Adding schema fields for these creates impossible template variables that the 
  LLM cannot resolve at execution time.
- ⚠️ CRITICAL: USE STANDARD PLAYER STATE FIELDS - The base schema provides "actionRequired" 
  (boolean) to indicate whether a player must take an action for the game to progress. 
  DO NOT create custom fields like "hasSubmitted", "hasMoved", "turnComplete", "choiceMade", 
  etc. to track whether a player has completed their action. ALWAYS use the standard 
  "actionRequired" field for this purpose. When a player completes all required actions 
  (submits a choice, makes a move, etc.),even if the payer may still take optional actions, 
  the game logic will set actionRequired=false. This ensures the router can reliably 
  determine when all players have acted and automatic transitions can proceed.
- ⛔ NEVER ADD TIMING OR ELAPSED-TIME FIELDS: Do NOT add any field that tracks elapsed time,
  phase duration, countdowns, or when a phase started. Examples of forbidden field names:
  phaseElapsedMs, elapsedSeconds, phaseStartTime, timerMs, countdownMs, remainingSeconds,
  waitStartedAt, timeoutAt. Phase timing is managed entirely by the runtime engine, which
  reads the humanSummary of each transition to configure timers automatically. Preconditions
  only evaluate stored game state — they never evaluate elapsed time.

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
