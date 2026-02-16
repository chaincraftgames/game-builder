/**
 * Prompts for Instructions Extraction
 */

export const planInstructionsTemplate = `
!___ CACHE:universal-instructions ___!
# Planner Output Schema
<planningSchema>
{planningSchemaJson}
</planningSchema>

# Your Task

Analyze the game specification and transitions to extract semantic information needed for instruction execution.

Focus on:
- **Game mechanics/rules**: Win conditions, scoring, trump rules, costs, constraints
- **LLM requirements**: Does this need LLM reasoning or semantic validation?
- **Message purposes**: Brief description of what messages should convey
- **Randomness**: Probability distributions, ranges, what values are needed

# Output Rules

1. **Player Actions**: Provide hints ONLY for phases requiring player input
2. **Transitions**: Provide hints for EVERY automatic transition  
3. **mechanicsDescription**: Natural language rules (null if purely administrative)
4. **requiresLLMValidation/requiresLLMReasoning**: Boolean flags
5. **Message purposes**: Brief strings (null if no message needed)

# Critical Fields (mention in globalNotes)
- **game.gameEnded**: At least one transition must set this to true
- **players.{{playerId}}.isGameWinner**: Set in transitions leading to finished phase
- **players.{{playerId}}.actionRequired**: Every player action must set this

Return EXACTLY one JSON object matching the schema.
!___ END-CACHE ___!

!___ CACHE:design-spec ___!
# Game Specification
<specification>
{gameSpecification}
</specification>

# Narrative Markers Available
{narrativeMarkersSection}
!___ END-CACHE ___!

!___ CACHE:artifacts ___!
# Phase Names (use exactly as shown)
{phaseNamesList}

# Transition IDs (use exactly as shown)
{transitionIdsList}

# Transitions Artifact
<transitions>
{transitionsArtifact}
</transitions>

# State Schema
<schema>
{stateSchema}
</schema>
!___ END-CACHE ___!

{validationFeedback}
`;

/**
 * Executor prompt: Generates concrete templated instructions from planner hints
 */
export const executeInstructionsTemplate = `
!___ CACHE:universal-executor ___!
# Executor Output Schema
{executorSchemaJson}

# Your Task

You are generating executable game instructions from high-level hints.

Your task: Convert the planner's instruction hints into concrete, 
templated instructions that the game runtime can execute.

# Key Principles

## 1. StateDelta Operations (Atomic State Changes)

ALL state changes must be expressed as atomic StateDelta operations:

**set**: Set a value at a path (REQUIRED: must include 'value' field)
{{ "op": "set", "path": "game.phase", "value": "reveal" }}
{{ "op": "set", "path": "game.publicMessage", "value": "Game starting!" }}

**ARRAY ELEMENTS**: Use bracket notation to set array elements directly:
{{ "op": "set", "path": "game.colors[0]", "value": "red" }}
{{ "op": "set", "path": "game.colors[1]", "value": "blue" }}
{{ "op": "set", "path": "players[0].name", "value": "Alice" }}
This is simpler and more reliable than using intermediate fields with template expansion.

**increment**: Add to a numeric value (REQUIRED: must include 'value' field)
{{ "op": "increment", "path": "players.{{{{winnerId}}}}.score", "value": 1 }}

**append**: Add item to array (REQUIRED: must include 'value' field)
{{ "op": "append", "path": "game.history", "value": {{ "round": "{{{{game.round}}}}" }} }}

**delete**: Remove a field (NO 'value' field - only 'path')
{{ "op": "delete", "path": "players.{{{{playerId}}}}.choice" }}

**transfer**: Move numeric value between paths (uses 'amount' not 'value')
{{ "op": "transfer", "fromPath": "game.pot", "toPath": "players.{{{{winnerId}}}}.chips", "amount": 10 }}

**merge**: Shallow merge object properties (REQUIRED: must include 'value' field)
{{ "op": "merge", "path": "players.{{{{playerId}}}}", "value": {{ "ready": true }} }}

**rng**: Random selection from choices with probabilities (NOTE: probabilities must sum to 1.0)
**CRITICAL**: Each RNG operation generates ONE value only. To generate multiple values, use multiple separate RNG operations.
**RECOMMENDED**: For populating array elements, use bracket notation directly in the path:
{{ "op": "rng", "path": "game.options[0]", "choices": ["A", "B", "C"], "probabilities": [0.33, 0.33, 0.34] }}
{{ "op": "rng", "path": "game.options[1]", "choices": ["A", "B", "C"], "probabilities": [0.33, 0.33, 0.34] }}
{{ "op": "rng", "path": "game.options[2]", "choices": ["A", "B", "C"], "probabilities": [0.33, 0.33, 0.34] }}

Other examples:
{{ "op": "rng", "path": "game.mood", "choices": ["calm", "tense", "chaotic"], "probabilities": [0.33, 0.33, 0.34] }}
{{ "op": "rng", "path": "game.specialEvent", "choices": [true, false], "probabilities": [0.05, 0.95] }}

**Template Variables in Paths**: Use {{{{variableName}}}} for runtime values:
{{ "op": "set", "path": "players.{{{{playerId}}}}.choice", "value": "{{{{input.choice}}}}" }}
{{ "op": "increment", "path": "players.{{{{winnerId}}}}.score", "value": 1 }}

**Path Structure Requirements (CRITICAL)**:
- Each path segment must be EITHER a literal OR a complete template variable
- NEVER mix literals and templates within a single segment
- Valid: "players.{{{{playerId}}}}.score" (each segment is atomic)
- Invalid: "game.roundWinsP{{{{playerId}}}}" (mixes "roundWinsP" + template)
- If you need player-specific fields, structure the schema with nested player objects:
  Use "players.{{{{playerId}}}}.roundsWon" NOT "game.roundWinsP{{{{playerId}}}}"

**Prefer Atomic Operations**: Break complex changes into simple atomic ops.

**CRITICAL VALIDATION**: All operations EXCEPT 'delete' MUST include the appropriate value/amount field:
- set, increment, append, merge → MUST have 'value' field
- transfer → MUST have 'amount' field (not 'value')
- delete → ONLY has 'path' field (NO 'value')
- rng → MUST have 'choices' and 'probabilities' arrays

## 2. JsonLogic Validation

Express validation as an ordered array of named validation checks (for player action inputs only).
Each check has: id, logic (JsonLogic), and errorMessage.
The runtime evaluates checks in order and returns the first error message where logic evaluates to false.

**Common JsonLogic patterns**:

Check equality: {{ "==": [{{ "var": "game.phase" }}, "choice"] }}
Check field exists: {{ "!!": {{ "var": "players.p1.choice" }} }}
Check field NOT exists: {{ "!": {{ "var": "players.{{{{playerId}}}}.choice" }} }}
Multiple conditions (AND): {{ "and": [...] }}
Multiple conditions (OR): {{ "or": [...] }}
Check value in array: {{ "in": [{{ "var": "input.choice" }}, ["rock", "paper", "scissors"]] }}
Numeric comparisons: {{ "<": [...] }}, {{ ">=": [...] }}

**Validation structure**:
{{
  "validation": {{
    "checks": [
      {{
        "id": "wrongPhase",
        "logic": {{ "==": [{{ "var": "game.phase" }}, "choice"] }},
        "errorMessage": "Cannot submit choice - not in choice phase"
      }},
      {{
        "id": "alreadySubmitted",
        "logic": {{ "!": {{ "var": "players.{{{{playerId}}}}.choice" }} }},
        "errorMessage": "You have already submitted your choice"
      }},
      {{
        "id": "invalidChoice",
        "logic": {{ "in": [{{ "var": "input.choice" }}, ["rock", "paper", "scissors"]] }},
        "errorMessage": "Choice must be rock, paper, or scissors"
      }}
    ]
  }}
}}

**Order matters**: First failing check determines error message returned.

## 3. Mechanics Guidance

When planner hints include mechanicsDescription, format as structured guidance:

{{
  "rules": [
    "Rock beats scissors",
    "Scissors beats paper",
    "Paper beats rock",
    "If both players choose the same option, the round is a tie"
  ],
  "computation": "Compare player choices to determine winner, then increment winner's score by 1 (or no change if tie)"
}}

## 4. Message Templates

**⚠️ CRITICAL: DO NOT use stateDelta to set message fields!** Runtime auto-populates from messages section.

**Structure:**
{{
  "stateDelta": [ /* NO message operations here */ ],
  "messages": {{
    "private": [{{ "to": "{{{{playerId}}}}", "template": "You submitted {{{{input.choice}}}}" }}],
    "public": {{ "template": "{{{{winnerName}}}} wins!" }}
  }}
}}

- \`private\`: Array with \`to\` (player ID) and \`template\` (text)
- \`public\`: Object with \`template\` only (all players)
- Both optional, use {{{{variables}}}} in templates

## 5. Template Variable Patterns

Common variable patterns:
- **Player references**: playerId, playerName, winnerId, winnerName, p1Name, p2Name
- **Input data**: input.choice, input.bid, input.cardId
- **Game state**: game.round, game.phase, currentRound, nextRound
- **Outcomes**: outcome, winnerId, winnerName
- **Scores/values**: p1Score, p2Score, p1Choice, p2Choice

# Special Instructions

**Standard Player State Fields**:

**actionRequired** (boolean) - REQUIRED field for EVERY player action:
- ⚠️ CRITICAL: EVERY player action's stateDelta MUST include an operation to set actionRequired
- Set to false when player has completed all required actions for this phase
- Set to true when player must take additional actions (multi-step phases like bet-then-confirm)
- The router uses this flag to determine if the game can proceed or must wait for player input
- Missing this operation will cause deadlocks where transitions cannot fire
- Example: {{ "op": "set", "path": "players.{{{{playerId}}}}.actionRequired", "value": false }}
- DO NOT create custom completion flags (hasSubmitted, hasMoved, etc.) - use actionRequired only

**actionsAllowed** (boolean) - OPTIONAL field for games with optional/voluntary actions:
- For MOST games, omit actionsAllowed operations - it will default to match actionRequired
- Only include actionsAllowed if the spec explicitly mentions optional or voluntary actions
- Use when: player can act but isn't required to (actionRequired: false, actionsAllowed: true)
- Example: {{ "op": "set", "path": "players.{{{{playerId}}}}.actionsAllowed", "value": true }}

**illegalActionCount** (number) - Tracks invalid/illegal action attempts:
- Increment on validation failures
- Initialize to 0 in initialization transitions
- Example: {{ "op": "increment", "path": "players.{{{{playerId}}}}.illegalActionCount", "value": 1 }}

**Game Completion Fields (CRITICAL - Required for ALL games)**:

**game.gameEnded** (boolean) - REQUIRED in transitions that end the game:
- ⚠️ CRITICAL: At least ONE transition must set game.gameEnded to true
- This signals the game has reached a terminal state and should not continue
- Set in transitions that move to the "finished" phase or when game ends
- Example: {{ "op": "set", "path": "game.gameEnded", "value": true }}
- Missing this will cause validation failure: "No transition sets game.gameEnded=true"

**players.{{{{playerId}}}}.isGameWinner** (boolean) - Set to true for winning player(s):
- ⚠️ CRITICAL: MUST be set on ALL paths to the "finished" phase (except no-winner scenarios)
- Set to true for each player who won the game
- Leave as false (default) for players who didn't win or in draw scenarios
- Runtime automatically computes game.winningPlayers array from these flags
- Can be set in same transition as gameEnded OR in an earlier transition
- Examples:
  * Single winner: {{ "op": "set", "path": "players.{{{{winnerId}}}}.isGameWinner", "value": true }}
  * Multiple winners (tie): Two ops - {{ "op": "set", "path": "players.{{{{player1Id}}}}.isGameWinner", "value": true }} and {{ "op": "set", "path": "players.{{{{player2Id}}}}.isGameWinner", "value": true }}
  * No winner (draw/abandoned): No operations needed - all flags remain false
- Missing this will cause validation failure: "Path [phases] does not set isGameWinner"
- If game has multiple ending scenarios, EACH ending transition must set isGameWinner appropriately

**Example: Complete game-ending transition stateDelta (sets BOTH required fields)**:
{{
  "stateDelta": [
    {{ "op": "set", "path": "players.{{{{winnerId}}}}.isGameWinner", "value": true }},
    {{ "op": "set", "path": "game.gameEnded", "value": true }},
    {{ "op": "set", "path": "game.publicMessage", "value": "Game Over! {{{{winnerName}}}} wins!" }}
  ]
}}

**State cleanup**: If planner hints indicate fields should be cleared/reset 
(e.g., "clear both players' choice fields"), use delete ops or set to null as specified

**⚠️ CRITICAL: The Transition From "init" Phase (typically "initialize_game")**

**ABSOLUTE REQUIREMENT**: The transition from the "init" phase MUST initialize EVERY field that appears
in ANY transition precondition throughout the entire game. If ANY later transition has a precondition that
compares \`game.roundNumber < game.maxRounds\`, BOTH \`game.roundNumber\` AND \`game.maxRounds\` must be
initialized by the "init" transition. Otherwise those transitions will deadlock comparing undefined values.

When planner says "initialize X" or "set X to Y", you MUST generate explicit stateDelta operations.
Do NOT assume schema defaults - runtime requires explicit set operations.

**Review ALL transition preconditions in the transitions artifact** and ensure every referenced field is initialized:
- If ANY precondition checks \`game.roundNumber\`, \`game.maxRounds\`, etc. → initialize them in init
- If ANY precondition checks \`players[*].currentMove\` → initialize for all players in init
- If ANY precondition checks any counter or flag → initialize it to appropriate starting value in init

**For ALL players** (when planner says "initialize player scores" or "set actionRequired for all players"):
Use the **setForAllPlayers** operation when setting the same value for all players:
{{ "op": "setForAllPlayers", "field": "score", "value": 0 }}
{{ "op": "setForAllPlayers", "field": "actionRequired", "value": true }}

**Common initializations** planner will request:
- Player fields → {{ "op": "setForAllPlayers", "field": "fieldName", "value": <value> }}
- Game counters → {{ "op": "set", "path": "game.roundNumber", "value": 1 }}

⚠️ Operations like "increment" WILL FAIL if field is undefined - must initialize first!

**Increment counters**: Use increment op for round/turn counters

**Error messages**: Provide clear, player-friendly error messages

**Template consistency**: Use same variable names across stateDelta, messages, validation

# Example Player Action

{{
  "id": "submit-choice",
  "actionName": "Submit Choice",
  "description": "Player submits rock/paper/scissors choice",
  "validation": {{
    "checks": [
      {{
        "id": "wrongPhase",
        "logic": {{ "==": [{{ "var": "game.phase" }}, "choice"] }},
        "errorMessage": "Cannot submit choice - not in choice phase"
      }},
      {{
        "id": "alreadySubmitted",
        "logic": {{ "!": {{ "var": "players.{{{{playerId}}}}.choice" }} }},
        "errorMessage": "You have already submitted your choice"
      }},
      {{
        "id": "invalidChoice",
        "logic": {{ "in": [{{ "var": "input.choice" }}, ["rock", "paper", "scissors"]] }},
        "errorMessage": "Choice must be rock, paper, or scissors"
      }}
    ]
  }},
  "stateDelta": [
    {{ "op": "set", "path": "players.{{{{playerId}}}}.choice", "value": "{{{{input.choice}}}}" }},
    {{ "op": "set", "path": "players.{{{{playerId}}}}.actionRequired", "value": false }}
  ],
  "messages": {{
    "private": [
      {{ "to": "{{{{playerId}}}}", "template": "Choice recorded: {{{{input.choice}}}}" }}
    ],
    "public": {{ "template": "{{{{playerName}}}} has submitted their choice" }}
  }}
}}

# Example Automatic Transition (Deterministic)

{{
  "id": "resolve-round",
  "transitionName": "Resolve Round",
  "description": "Apply RPS rules and update score",
  "priority": 10,
  "mechanicsGuidance": {{
    "rules": ["Rock beats scissors", "Scissors beats paper", "Paper beats rock", "Tie if same"],
    "computation": "Compare choices, determine winner, increment winner's score by 1"
  }},
  "stateDelta": [
    {{ "op": "increment", "path": "players.{{{{winnerId}}}}.score", "value": 1 }},
    {{ "op": "delete", "path": "players.p1.choice" }},
    {{ "op": "delete", "path": "players.p2.choice" }},
    {{ "op": "set", "path": "players.p2.actionRequired", "value": true }}
  ],
  "messages": {{
    "public": {{ "template": "Round {{{{game.round}}}}: {{{{p1Name}}}} ({{{{p1Choice}}}}) vs {{{{p2Name}}}} ({{{{p2Choice}}}}). {{{{outcome}}}}! Scores: {{{{p1Score}}}}-{{{{p2Score}}}}" }}
  }}
}}  "public": {{ "to": "all", "template": "Round {{{{game.round}}}}: {{{{p1Name}}}} ({{{{p1Choice}}}}) vs {{{{p2Name}}}} ({{{{p2Choice}}}}). {{{{outcome}}}}! Scores: {{{{p1Score}}}}-{{{{p2Score}}}}" }}
  }}
}}

# Example Automatic Transition (With RNG)

{{
  "id": "initialize-game",
  "transitionName": "Initialize Game",
  "description": "Set up initial game state with random oracle mood",
  "priority": 1,
  "stateDelta": [
    {{ "op": "rng", "path": "game.oracleMood", "choices": ["calm", "irritable", "cryptic"], "probabilities": [0.33, 0.33, 0.34] }},
    {{ "op": "set", "path": "game.phase", "value": "greeting" }},
    {{ "op": "setForAllPlayers", "field": "trustLevel", "value": 0 }}
  ],
  "messages": {{
    "public": {{ "template": "You stand before the oracle. The air is thick with ancient power." }}
  }}
}}
!___ END-CACHE ___!

!___ CACHE:design-executor ___!
# Game Specification Context
{gameSpecificationSummary}

# Narrative Markers Available
{narrativeMarkersSection}

**Narrative Markers:**
If planner hints include !___ NARRATIVE:MARKER_NAME ___! references, preserve them in mechanicsGuidance.
Runtime expands them before LLM invocation. Use for narrative/atmospheric content, not mechanical operations.
!___ END-CACHE ___!

!___ CACHE:artifacts-executor ___!
# ⚠️ USE THESE EXACT PHASE NAMES - DO NOT MODIFY ⚠️

{phaseNamesList}

# ⚠️ USE THESE EXACT TRANSITION IDs - DO NOT MODIFY ⚠️

{transitionIdsList}

# CRITICAL ID MATCHING REQUIREMENTS

Your instructions[].phase field must EXACTLY match a phase name from the list above.
Your automaticTransitions[].id field must EXACTLY match a transition ID from the list above.

DO NOT create variations. COPY THE EXACT STRINGS INCLUDING CAPITALIZATION.

# State Schema
{stateSchema}

# Planner Hints
{plannerHints}
!___ END-CACHE ___!

{validationFeedback}

# ⚠️ FINAL REMINDER - EXACT ID MATCHING ⚠️

Before outputting, verify:
✓ Every phase name in your output is FROM THE PHASE LIST ABOVE
✓ Every transition ID in your output is FROM THE TRANSITION ID LIST ABOVE
✓ You copied them EXACTLY (same capitalization, underscores, hyphens)

If the phase list has "choicePhase", use "choicePhase" NOT "choice_phase".
If the ID list has "both_players_submitted", use "both_players_submitted" NOT "both-submitted".

Now generate the complete instructions artifact.
`;
