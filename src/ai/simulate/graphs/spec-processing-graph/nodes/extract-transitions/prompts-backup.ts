/**
 * Prompts for State Transitions Extraction
 * 
 * Generates structured phase transition guide for runtime AI agent.
 */

export const planTransitionsTemplate = `
You are creating a phase transition specification for a game.

🚨 CRITICAL RULE #1: checkedFields = INPUTS ONLY 🚨

The 'checkedFields' array lists fields the transition will READ to decide if it should fire.
NEVER include fields the transition will WRITE/UPDATE/CLEAR.

✅ CORRECT: Fields that exist BEFORE the transition fires
   Example: ["game.currentPhase", "game.currentRound"]
   
❌ WRONG: Fields the transition will SET or MODIFY
   Example: ["players[*].score"] ← transition updates scores, don't check them!
   Example: ["game.gameEnded"] ← transition sets this, don't check it!

Rule of thumb: If the field appears in stateChanges or requiredOutputFields, 
it should NOT be in checkedFields.

⚠️ CRITICAL: You MUST start from this initial transitions template and expand it.

Initial Transitions Template (REQUIRED STARTING POINT):
<initialTransitionsTemplate>
{initialTransitionsTemplate}
</initialTransitionsTemplate>

YOUR TASK:
1. Take the init phase and initialize_game transition from the template above
2. Replace <FIRST_GAMEPLAY_PHASE> with the actual first gameplay phase from the spec
3. Fill in what initial state setup is needed (scores, inventories, etc.) in the condition
4. Add ALL gameplay phases identified from the spec to the "phases" array (keeping "init" first)
5. Add phaseMetadataHints for all phases
6. Add all gameplay transition candidates

⚠️ IMPORTANT: If the spec mentions setup/initialization phases, DO NOT create separate phases.
Instead, incorporate that setup logic into the init phase. The init phase should handle ALL
initialization so that when it completes, the game is ready to accept player input with no
further setup required.

Game Specification:
<specification>
{gameSpecification}
</specification>

⚠️ CRITICAL: When writing preconditions, ONLY reference fields from this explicit list:
<availableFields>
{availableFields}
</availableFields>

⛔ FORBIDDEN: DO NOT invent field names. DO NOT use similar-sounding names.
   WRONG: players[*].playerInput, players[*].userChoice, players[*].action
   RIGHT: Only use exact field names from the list above

You MUST use the EXACT field paths shown above (including [*] wildcard for player fields).
If a field is not in the list, you CANNOT reference it in preconditions.

{computedContextFields}

Planner Output (PLANNING JSON) Schema 
<planningSchema>
{planningSchemaJson}
</planningSchema>

INITIAL STRUCTURE (MANDATORY - DO NOT SKIP):
Output contract (RETURN EXACTLY two parts in this order):
1) A 1-3 sentence natural-language summary of the phase structure and high-level 
   transition logic.
2) A single JSON object (and nothing else) matching the simplified PLANNING JSON shape
   (example below). 
   THIS IS NOT THE FINAL TRANSITIONS ARTIFACT — do NOT output JsonLogic or final 
   transition code here. The executor will synthesize JsonLogic from these planning hints.

{{
  "phases": ["init", "phaseA", "phaseB", "phaseC", "finished"],
  "phaseMetadataHints": [
    {{ "phase": "init", "requiresPlayerInput": false }},
    {{ "phase": "phaseA", "requiresPlayerInput": true }},
    {{ "phase": "phaseB", "requiresPlayerInput": false }},
    {{ "phase": "finished", "requiresPlayerInput": false }}
  ],
  "transitionCandidates": [
    {{
      "id": "initialize",
      "fromPhase": "init",
      "toPhase": "phaseA",
      "priority": 1,
      "condition": "game starts",
      "checkedFields": ["game.currentPhase"],
      "preconditionHints": [
        {{ "id": "is_init", "explain": "Check if currentPhase is 'init'" }}
      ],
      "humanSummary": "Initialize game state and transition to first gameplay phase"
    }},
    {{
      "id": "string",
      "fromPhase": "string",
      "toPhase": "string",
      "priority": 100,
      "condition": "short human-readable condition referring to state paths or computed context",
      "checkedFields": ["players[*].submittedMove", "game.currentRound"],
      "computedValues": {{ "submittedCount": "count(players[*].hasSubmitted)" }},
      "preconditionHints": [
        {{ "id": "string", "explain": "brief explanation referencing exact state paths (aim <200 chars, max 500)" }}
      ],
      "humanSummary": "one-line summary"
    }}
  ]
}}

⚠️⚠️⚠️ REMINDER: checkedFields Rules ⚠️⚠️⚠️

Review CRITICAL RULE #1 at the top of this prompt.

Quick checklist for each transition:
- [ ] checkedFields only contains INPUT fields (what transition reads)
- [ ] NO fields from stateChanges appear in checkedFields
- [ ] NO OUTPUT fields (what transition writes) in checkedFields

Common mistakes to avoid:
- DON'T check if scores have been updated (transition updates them!)
- DON'T check if moves have been cleared (transition clears them!)
- DON'T check if gameEnded is true (transition sets it!)

🚨 CRITICAL RULE #2: Conditional Branching Requires Separate Transitions 🚨

If a state event can lead to DIFFERENT outcomes based on game state, you MUST create
SEPARATE transitions with different preconditions and target phases.

❌ WRONG Pattern (one transition trying to handle multiple outcomes):
  {{
    "id": "round_complete",
    "condition": "Increment round if < 2, OR end game if round == 2",
    "toPhase": "round_active",  ← Can't conditionally change target phase!
  }}

✅ CORRECT Pattern (separate transitions for each outcome):
  {{
    "id": "round_complete_continue",
    "fromPhase": "scoring",
    "toPhase": "round_active",
    "preconditionHints": [
      {{ "id": "more_rounds", "explain": "roundNumber < 2" }}
    ],
    "condition": "Increment round and continue to next round"
  }},
  {{
    "id": "round_complete_end_game",
    "fromPhase": "scoring", 
    "toPhase": "finished",
    "priority": 2,  ← Lower priority (evaluated first) for game-ending condition
    "preconditionHints": [
      {{ "id": "last_round", "explain": "roundNumber >= 2" }}
    ],
    "condition": "All rounds complete, end game and declare winner"
  }}

Key principle: ONE transition = ONE outcome with ONE target phase.
If the spec says "do X OR Y depending on condition", create 2 transitions.

Common examples requiring separate transitions:
- Multi-round games: separate transition for "continue to next round" vs "end game"
- Turn-based games: separate transition for "next player" vs "round complete"
- Scoring thresholds: separate transition for "continue playing" vs "player wins"

🚨 CRITICAL RULE #4: Avoid "Processing Phases" Anti-Pattern 🚨

A "processing phase" is a phase that:
- Does NOT require player input
- Has only ONE automatic outbound transition
- Exists ONLY to trigger that next transition
- The transition does minimal work (just changes phase + message)

This is an ANTI-PATTERN. Here's why:

❌ WRONG Pattern:
  submission_phase → [moves_submitted: just changes phase] → 
  resolution_phase → [resolve: does actual scoring work] → next_phase

The problem: resolution_phase serves no purpose. It doesn't wait for input, doesn't
branch to different outcomes, just immediately triggers the next transition.

✅ CORRECT Pattern:
  submission_phase → [moves_submitted: scores moves AND changes phase] → next_phase

Each transition should perform ALL its state updates atomically:
- Compare/evaluate game state
- Update scores, flags, counters
- Clear temporary data
- Set appropriate messages
- Change to the target phase

The ONLY exception is the "finished" phase - it's terminal and only sets gameEnded.

Before creating a phase, ask:
1. Does this phase wait for player input? → If yes, it's needed
2. Does this phase branch to multiple transitions based on conditions? → If yes, it's needed
3. Is this phase just a waypoint to trigger one automatic transition? → ANTI-PATTERN, merge the work

🚨 CRITICAL RULE #5: Deterministic Preconditions - Allowed Field Access Patterns 🚨

ALL preconditions MUST use JsonLogic with only these allowed patterns:

✅ ALLOWED:
• Game-level fields: game.currentPhase, game.roundNumber, game.nextPlayerId
• Computed properties: allPlayersCompletedActions, activePlayerCount
• Wildcard patterns: players[*].actionRequired (checks all players match condition)
• Previously denormalized fields: Values computed and stored by prior transitions

❌ NEVER ALLOWED:
• Array indices: players[0].choice, players[1].score
• Dynamic lookups: players.{{expression}}.field, configMap[currentContext]
• Iteration/loops: Cannot iterate through players in preconditions  
• Conditional access: if (condition) check player1 else check player2

Denormalization Pattern:
If you need to check player-specific or computed values, a PRIOR transition must:
1. Compute that value (using LLM, RNG, or mechanics guidance)
2. Store it in a direct game-level field
3. Then this transition checks the pre-computed field

Examples:
  ❌ WRONG: "players[0].choice !== null" (array index)
  ✅ RIGHT: "allPlayersCompletedActions === true" (computed property)
  
  ❌ WRONG: "configMap[currentContext] === targetValue" (dynamic lookup)
  ✅ RIGHT: Prior transition sets "game.currentContextValue", then check that field

Rules & guidance:
- ⚠️ MANDATORY: Your JSON output MUST include the init phase and initialize_game transition 
  from the Initial Transitions Template, with <FIRST_GAMEPLAY_PHASE> replaced
- ⚠️ MANDATORY: The phases array MUST be ["init", ...gameplay phases..., "finished"]
  - MUST start with "init"
  - MUST end with "finished" 
  - Example: ["init", "calling", "flipping", "scoring", "finished"]
- ⚠️ MANDATORY: The transitionCandidates array MUST start with [initialize_game, ...gameplay transitions]
- ⚠️ MANDATORY: There must be at least one transition with toPhase: "finished" (the game-ending transition)
- Add all distinct gameplay phases between "init" and "finished" in the phases array
- 'phaseMetadataHints' must include init first, then all gameplay phases
- If the spec describes setup/initialization logic, incorporate it into the init phase's condition
  and preconditionHints. Do NOT create separate "setup" or "initialization" phases.
- The init phase is the ONLY initialization phase. When it completes, the game must be fully
  ready for player interaction with all state properly initialized.
- Other phases: indicate whether that phase requires player input (e.g., players must 
  submit moves, make choices) to proceed. Phases that automatically compute/update state 
  without player input should have requiresPlayerInput: false.
- Each transition's 'checkedFields' must be exact dot-paths (support simple '[*]' 
  wildcard for arrays) into the provided state schema.

Precondition guidelines:
- 'preconditions' is an array of precondition objects that will be synthesized into JsonLogic.
- The \`explain\` field should be a brief (aim <200 chars, max 500) description referencing 
  exact state paths using dot notation (e.g., "game.currentRound > 2", "players[*].hasSubmitted == true").
- Follow CRITICAL RULE #5 above - use only allowed field access patterns.
- The following computed variables described in the computedContextSchema can 
    (and often should) be used to simplify precondition expressions.
  - During evaluation, preconditions will have access to BOTH the full game state 
    (from stateSchema) AND these computed context fields.
  - These computed values will be available to the executor when synthesizing JsonLogic.
  - Return at most 8 transitions. Use clear, stable ids for transitions.
  - Do NOT include side-effects or stateDelta ops in this output; transitions only 
    describe WHEN the game moves phases.
`;

export const executeTransitionsTemplate = `
You are creating the final transitions specification for a game.

⚠️ CRITICAL: The planner output includes an init phase and initialize_game transition.
You MUST preserve these in your final output - they are mandatory for every game.

Transitions Plan:
<transitionsPlan>
{transitionsPlan}
</transitionsPlan>

⚠️ CRITICAL: When generating JsonLogic preconditions, ONLY reference fields from this list:
<availableFields>
{availableFields}
</availableFields>

⛔ FORBIDDEN: DO NOT invent field names. DO NOT use similar-sounding names.
   WRONG: {{"var": "players[0].playerInput"}}, {{"var": "players[*].userChoice"}}
   RIGHT: Only use exact field paths from the list above in {{"var": "..."}} expressions

When writing JsonLogic, you MUST use ONLY these exact field paths.
If a field is not in the list, you CANNOT reference it.

{computedContextFields}

This is the schema for JSONLogic objects the executor can use in transition preconditions.
<JsonLogicSchema>
{jsonLogicSchema}
</JsonLogicSchema>

Return EXACTLY one JSON object (and nothing else) conforming to the  
\`TransitionsArtifactSchema\`.
<transitionsArtifactSchema>
{{transitionsArtifactSchemaJson}}
</transitionsArtifactSchema>

Inputs available to you:
- \`{{transitionsPlan}}\`: the planner output (PLANNING JSON) containing \`phases\` 
  and \`transitionCandidates\`.
- \`{{stateSchema}}\`: the canonical state schema for the game.
- \`{{computedContextSchema}}\`: schema for computed context variables available to 
  the router/executor (e.g., \`playerCount\`, \`actionsPendingPlayerCount\`, 
  \`allPlayerActionsComplete\`).

IMPORTANT: During precondition evaluation, JsonLogic expressions will have access to 
the FULL game state (all fields from availableFields) PLUS the computed context fields 
(from computedContextFields). You can reference any field from either list in your 
preconditions.

⚠️ CRITICAL: Understanding Preconditions

Preconditions define state that must ALREADY EXIST before a transition fires.
Preconditions check INPUTS, never OUTPUTS.

How to determine correct preconditions:
1. Look at the planning output's 'checkedFields' for this transition
2. These are the fields the transition READS to make decisions
3. Create preconditions ONLY for fields in 'checkedFields'
4. NEVER create preconditions for fields the transition will WRITE

Common RPS Example (round_scored transition):
  ✅ CORRECT precondition: currentPhase == "round_scoring" AND currentRound == 1
  ❌ WRONG precondition: Check if scores have been updated
     (The transition UPDATES scores - they don't exist beforehand!)

Another Example (final_round_scored transition):
  ✅ CORRECT precondition: currentPhase == "round_scoring" AND currentRound == 2  
  ❌ WRONG precondition: Check if gameEnded is true
     (The transition SETS gameEnded - it's false beforehand!)

Rules for preconditions:
- ✅ CORRECT: Precondition checks fields from 'checkedFields' (transition reads these)
- ❌ WRONG: Precondition checks fields the transition will write (outputs)
- ✅ CORRECT: Check currentPhase = "flipping" (input: determines if transition should fire)
- ❌ WRONG: Check coinFlipResult exists (output: transition will SET this via RNG)
- ✅ CORRECT: Check both players submitted calls (input: data already exists from player actions)
- ❌ WRONG: Check final scores exist (output: transition will COMPUTE these)

Example from planning output:
{{
  "id": "coin_flipped",
  "requiredInputFields": ["game.currentPhase"],
  "requiredOutputFields": ["game.coinFlipResult", "game.currentPhase"]
}}

Correct preconditions for coin_flipped:
- currentPhase == "flipping" ✅ (from requiredInputFields)
- DO NOT check if coinFlipResult exists ❌ (in requiredOutputFields - transition creates it!)

Executor responsibilities (strict):
- Produce \`phaseMetadata\` array with one entry per phase from the planner's 
  \`phaseMetadataHints\`, containing \`phase\` (string) and \`requiresPlayerInput\` 
  (boolean). Ensure every phase in \`phases\` has a corresponding metadata entry.
- For each \`transitionCandidate\` in \`{{transitionsPlan}}\` produce a final 
  \`transition\` object matching \`TransitionSchema\` and include it in the 
  \`transitions\` array of the returned object.
- For each \`preconditionHint\` in a candidate's \`preconditionHints\`:
  - Synthesize a JsonLogic object that implements the intent in the hint's \`explain\`.
  - Place that JsonLogic object into the precondition's \`logic\` field.
  - Set \`deterministic: true\` (all preconditions must be deterministic).
  - Copy the \`explain\` text to help document what the JsonLogic checks.
- Ensure each synthesized JsonLogic uses only the allowed operator set and references 
  state or computed context via \`var\` (e.g., {{ "var": "game.currentRound" }} or 
  {{ "var": "playerCount" }}).
- Ensure \`checkedFields\` lists all exact dot-paths your JsonLogic or \`explain\` 
  references (supporting simple \`[*]\` wildcard). Keep them minimal.
- Do NOT include side-effects or stateDelta ops here — transitions only describe 
  WHEN to change phases.

JsonLogic synthesis rules & operator whitelist:
- ⚠️ CRITICAL: You MUST ONLY use operations supported by json-logic-js library.
- Supported operations: \`==\`, \`===\`, \`!=\`, \`!==\`, \`>\`, \`>=\`, \`<\`, \`<=\`, 
  \`!\`, \`!!\`, \`and\`, \`or\`, \`if\`, \`+\`, \`-\`, \`*\`, \`/\`, \`%\`, \`max\`, \`min\`,
  \`map\`, \`filter\`, \`all\`, \`none\`, \`some\`, \`merge\`, \`in\`, \`cat\`, \`substr\`, 
  \`var\`, \`missing\`, \`missing_some\`, \`log\`.
- **CUSTOM OPERATIONS**: Use these specialized operations when needed:
  - \`allPlayers\`: Returns true if ALL players satisfy condition on a field.
    Format: \`{{"allPlayers": ["fieldName", "operator", compareValue]}}\`
    Example: \`{{"allPlayers": ["actionRequired", "==", false]}}\` checks if all players have actionRequired === false.
  - \`anyPlayer\`: Returns true if ANY player satisfies condition on a field.
    Format: \`{{"anyPlayer": ["fieldName", "operator", compareValue]}}\`
    Example: \`{{"anyPlayer": ["score", ">=", 3]}}\` checks if any player has score >= 3.
  - \`lookup\`: Access array elements or object properties using dynamic indices/keys from state.
    Format: \`{{"lookup": [collectionExpr, indexExpr]}}\`
    - collectionExpr: JsonLogic expression that resolves to an array or object
    - indexExpr: JsonLogic expression that resolves to a number (for arrays) or string (for objects)
    Returns: The element at the specified index/key, or undefined if not found.
    Example: \`{{"lookup": [{{"var": "game.deadlyOptions"}}, {{"var": "game.currentTurn"}}]}}\`
    Use cases: Per-round configuration data, card decks indexed by position, dynamic lookups based on game state.
    ⚠️ Use ONLY when index/key is dynamic (from state). For literal indices, use dot notation: \`{{"var": "array.2"}}\`
  - Supported operators: ==, !=, >, >=, <, <=
  - ⚠️ CRITICAL: Use ARRAY format ["field", "op", value], NOT object format.
  - Use these instead of template variables or trying to access specific player IDs.
- ⚠️ FORBIDDEN: Do NOT use \`reduce\`, \`forEach\`, \`find\`, or any other operations 
  not listed above. These will cause validation failures.
- ⚠️ CRITICAL: If you cannot express a condition using the supported operations, the game 
  design requires modification. You CANNOT create non-deterministic preconditions. Instead:
  * Have a prior transition compute/generate the value and write it to state
  * Then check that pre-computed state value in the precondition
- Use \`var\` to reference fields or computed context names.
- When synthesizing comparisons against booleans or strings, use strict equality 
  (\`==\`/\`!=\`).

Validation rules for final output:
- The final object must include \`phases\` (array of strings) and \`transitions\` 
  (array of transitions).
- Each transition must include at minimum: \`id\`, \`fromPhase\`, \`toPhase\`, 
  \`checkedFields\` (array), and \`preconditions\` (array of {{ id, logic|null, deterministic, explain }}).
- Limit to at most 8 transitions.

Example final output (return EXACTLY this JSON object as an example of the final shape):
{{
  "phases": ["setup","submission","scoring","finished"],
  "phaseMetadata": [
    {{ "phase": "setup", "requiresPlayerInput": false }},
    {{ "phase": "submission", "requiresPlayerInput": true }},
    {{ "phase": "scoring", "requiresPlayerInput": false }},
    {{ "phase": "finished", "requiresPlayerInput": false }}
  ],
  "transitions": [
    {{
      "id": "end_game",
      "fromPhase": "scoring",
      "toPhase": "finished",
      "checkedFields": ["currentRound"],
      "preconditions": [
        {{
          "id": "in_3rd_round",
          "logic": {{ "==": [ {{ "var": "game.currentRound" }}, 3 ] }},
          "deterministic": true,
          "explain": "end the game after scoring the 3rd round"
        }}
      ],
      "humanSummary": "Advance to finished after scoring the 3rd round"
    }}
  ]
}}

Return EXACTLY one JSON object and nothing else.
`;
