/**
 * Instructions Domain Knowledge
 *
 * Shared domain knowledge for instructions artifact extraction and editing.
 * Contains: StateDelta operations, JsonLogic validation, mechanics guidance,
 * message templates, template variables, standard player state fields,
 * game completion fields, init transition rules, and worked examples.
 */

export const INSTRUCTIONS_DOMAIN_KNOWLEDGE = `# Key Principles

## 1. StateDelta Operations (Atomic State Changes)

ALL state changes must be expressed as atomic StateDelta operations:

**set**: Set a value at a path (REQUIRED: must include 'value' field)
{{ "op": "set", "path": "game.phase", "value": "reveal" }}
{{ "op": "set", "path": "game.publicMessage", "value": "Game starting!" }}

**ARRAY ELEMENTS**: Use bracket notation to set array elements directly (game arrays only — NOT for player targeting):
{{ "op": "set", "path": "game.colors[0]", "value": "red" }}
{{ "op": "set", "path": "game.colors[1]", "value": "blue" }}
{{ "op": "set", "path": "game.scores[0]", "value": 0 }}
This is simpler and more reliable than using intermediate fields with template expansion.
⛔ **NEVER use \`set\` with a hardcoded number for dice or any random value** — use \`rng\` (see below). The runtime resolves \`rng\` ops using a proper RNG; hardcoded values are not random.
⛔ Do NOT use \`players[N]\` — players are keyed by UUID, not by index. Use setForAllPlayers, setForRandomPlayer, or \`players.player1.field\` literals instead.

**increment**: Add to a numeric value (REQUIRED: must include 'value' field)
{{ "op": "increment", "path": "game.roundNumber", "value": 1 }}

**append**: Add item to array (REQUIRED: must include 'value' field)
{{ "op": "append", "path": "game.history", "value": {{ "round": "{{{{game.round}}}}" }} }}

**delete**: Remove a field (NO 'value' field - only 'path')
{{ "op": "delete", "path": "players.{{{{playerId}}}}.choice" }}

**transfer**: Move numeric value between paths (uses 'amount' not 'value')
{{ "op": "transfer", "fromPath": "game.pot", "toPath": "game.playerFund", "amount": 10 }}
Note: to transfer to a specific player, target a literal field like \`players.player1.chips\` or handle it in mechanicsGuidance.

**merge**: Shallow merge object properties (REQUIRED: must include 'value' field)
{{ "op": "merge", "path": "players.{{{{playerId}}}}", "value": {{ "ready": true }} }}

**rng**: Random selection from choices with probabilities (NOTE: probabilities must sum to 1.0)
**CRITICAL**: Each RNG operation generates ONE value only. To generate multiple values, use multiple separate RNG operations.
**DICE ROLLING**: Always use \`rng\` for dice — NEVER hardcode die values with \`set\`:
{{ "op": "rng", "path": "game.dice[0]", "choices": [1, 2, 3, 4, 5, 6], "probabilities": [0.1667, 0.1667, 0.1667, 0.1667, 0.1667, 0.1665] }}
{{ "op": "rng", "path": "game.dice[1]", "choices": [1, 2, 3, 4, 5, 6], "probabilities": [0.1667, 0.1667, 0.1667, 0.1667, 0.1667, 0.1665] }}
**RECOMMENDED**: For populating array elements, use bracket notation directly in the path:
{{ "op": "rng", "path": "game.options[0]", "choices": ["A", "B", "C"], "probabilities": [0.33, 0.33, 0.34] }}
{{ "op": "rng", "path": "game.options[1]", "choices": ["A", "B", "C"], "probabilities": [0.33, 0.33, 0.34] }}
{{ "op": "rng", "path": "game.options[2]", "choices": ["A", "B", "C"], "probabilities": [0.33, 0.33, 0.34] }}

Other examples:
{{ "op": "rng", "path": "game.mood", "choices": ["calm", "tense", "chaotic"], "probabilities": [0.33, 0.33, 0.34] }}
{{ "op": "rng", "path": "game.specialEvent", "choices": [true, false], "probabilities": [0.05, 0.95] }}

**setFromMap**: Look up a value from game state in a hardcoded map and write the result. Use this when a player's choice needs to be translated to a derived constant (ticker → dataSourceId, choice → score, etc.).
{{ "op": "setFromMap", "keyPath": "players.{{{{playerId}}}}.selectedTicker", "map": {{ "BTC": "coinbase-btc-usd-price", "ETH": "coinbase-eth-usd-price", "SOL": "coinbase-sol-usd-price" }}, "path": "players.{{{{playerId}}}}.resolvedDataSourceId" }}
{{ "op": "setFromMap", "keyPath": "game.difficulty", "map": {{ "easy": 1, "medium": 3, "hard": 5 }}, "path": "game.startingLives", "fallback": 3 }}
- keyPath: dot-notation path to the state field whose value is the lookup key (supports template variables)
- map: hardcoded key→value dictionary; keys are strings, values can be any type
- path: where to write the result (supports template variables)
- fallback (optional): value to write if key is not found; if omitted and key is missing, op is skipped with a warning
- This is synchronous and deterministic — no LLM or async needed

**setFromDataSource**: Read live blockchain data into game state (PRE-RESOLVED by router, like rng)
The router resolves these to standard "set" operations before execute_changes sees them.
Only use dataSourceIds that are listed in the game's dataSources configuration.
{{ "op": "setFromDataSource", "dataSourceId": "chainlink-tsla-usd", "path": "game.tslaPrice" }}
{{ "op": "setFromDataSource", "dataSourceId": "cc-token-balance", "path": "players.{{{{playerId}}}}.tokenBalance", "paramValues": {{ "account": "{{{{players.{{{{playerId}}}}.walletAddress}}}}" }} }}

**DYNAMIC dataSourceId**: When the data source depends on a player's choice (e.g. player picked a ticker, each ticker has its own data source ID), store the resolved data source ID in game state during selection, then use a template variable:
{{ "op": "setFromDataSource", "dataSourceId": "{{{{players.{{{{playerId}}}}.resolvedDataSourceId}}}}", "path": "players.{{{{playerId}}}}.startPrice" }}
The resolvedDataSourceId field must be a valid data source ID string already written to game state.

- dataSourceId: exact data source ID string OR a template variable that resolves to one at runtime
- path: where to store the result in game state
- paramValues (optional): maps parameter names to values or template variables
- The data source's transform (extractField, decimals) is applied automatically
- If the data source read fails, the op is skipped (game continues without the data)

**Template Variables in Paths**: Use {{{{variableName}}}} for runtime values:
{{ "op": "set", "path": "players.{{{{playerId}}}}.currentAction.type", "value": "submit-choice" }}
{{ "op": "set", "path": "players.{{{{playerId}}}}.currentAction.choice", "value": "{{{{input.choice}}}}" }}

**Path Template Variables (CRITICAL — read carefully)**:
⛔ **\`{{{{playerId}}}}\` is the ONLY valid template variable in any stateDelta path.** It resolves to the acting player's UUID and is only valid in player action \`stateDelta\` (e.g. \`players.{{{{playerId}}}}.currentAction\`).
- ALL other template variables in paths — \`{{{{winnerId}}}}\`, \`{{{{game.someField}}}}\`, \`{{{{input.X}}}}\`, \`{{{{players[N]}}}}\`  etc. — are **NOT resolved at runtime**. They will be written as literal string keys into state, creating phantom fields or phantom players.
- \`players[{{{{game.startingPlayerIndex}}}}]\` — ❌ FORBIDDEN: \`{{{{game.X}}}}\` is not resolved in paths
- \`players[0]\`, \`players[1]\` — ❌ FORBIDDEN: players are keyed by UUID not index
- \`players.{{{{winnerId}}}}.score\` — ❌ FORBIDDEN: \`{{{{winnerId}}}}\` is not resolved
- \`players.{{{{playerId}}}}.currentAction\` — ✅ valid in player action stateDelta only
- \`game.round\`, \`game.currentBid\`, \`game.communalDice[2]\` — ✅ always valid (literal paths)
⛔ **Player action \`stateDelta\` MUST ONLY write \`players.{{{{playerId}}}}.currentAction\`.** Writing any other field from a player action is forbidden. The runtime will strip any other ops — they will be silently discarded. All other state changes (persisting player choices, updating game state, setting flags) MUST happen in the mechanic of the following automatic transition, which reads from \`currentAction\`.
**To target players in init/automatic transitions:**
- Target ALL players: use \`setForAllPlayers\` or \`setForRandomPlayer\` ops
- Target a literal player alias: \`players.player1.field\` (only when game always has exactly 2 known aliases)
- Complex targeting based on state (e.g. set actionRequired for game.roundWinner): put in **mechanicsGuidance** — the generated mechanic code has full state access

Path segment structure:
- Each path segment must be EITHER a literal OR \`{{{{playerId}}}}\` (the only exception)
- NEVER mix literals and templates within a single segment
- NEVER use bracket notation with template variables — always use dot notation
- Valid: "players.{{{{playerId}}}}.currentAction" (player action stateDelta only)
- Valid: "game.communalDice[2]" (numeric index for game arrays)
- Invalid: "game.roundWinsP{{{{playerId}}}}" (mixes literal + template in one segment)
- Invalid: "players[{{{{playerId}}}}]" (brackets around template variable)

⛔ **NEVER put JS expressions inside template variables**: {{{{...}}}} is a state path lookup ONLY.
- Valid: "{{{{players.player1.roundScore}}}}" (reads a stored value from state)
- Invalid: "{{{{score > 0 ? score : 0}}}}" (ternary — not supported, will become a literal string)
- Invalid: "{{{{Math.abs(game.delta)}}}}" (function call — not supported)
- Invalid: "{{{{a == 'UP' && b > 0}}}}" (boolean expression — not supported)
- If you need conditional computation or arithmetic: use **mechanicsGuidance** (see section 3).
  Generated mechanic code will implement the logic using actual state values.

**Prefer Atomic Operations**: Break complex changes into simple atomic ops.

**CRITICAL VALIDATION**: All operations EXCEPT 'delete' MUST include the appropriate value/amount field:
- set, increment, append, merge → MUST have 'value' field
- transfer → MUST have 'amount' field (not 'value')
- delete → ONLY has 'path' field (NO 'value')
- rng → MUST have 'choices' and 'probabilities' arrays
- setFromDataSource → MUST have 'dataSourceId' and 'path'; optionally 'paramValues'

## 2. JsonLogic Validation

Express validation as an ordered array of named validation checks (for player action inputs only).
Each check has: id, logic (JsonLogic), and errorMessage.
The runtime evaluates checks in order and returns the first error message where logic evaluates to false.

**How validation works:**
The runtime applies the player's stateDelta to a CANDIDATE state first, THEN evaluates validation.
This means players.{{{{playerId}}}}.currentAction is already written when checks run.
Template variable {{{{playerId}}}} is resolved to the acting player's alias before JsonLogic evaluation.

**Common JsonLogic patterns**:

Check equality: {{ "==": [{{ "var": "game.phase" }}, "choice"] }}
Check field exists: {{ "!!": {{ "var": "players.{{{{playerId}}}}.choice" }} }}
Check field NOT exists: {{ "!": {{ "var": "players.{{{{playerId}}}}.choice" }} }}
Multiple conditions (AND): {{ "and": [...] }}
Multiple conditions (OR): {{ "or": [...] }}
Check value in array: {{ "in": [{{ "var": "players.{{{{playerId}}}}.currentAction.choice" }}, ["rock", "paper", "scissors"]] }}
Numeric comparisons: {{ "<": [...] }}, {{ ">=": [...] }}

**Validation structure** (poker raise example — shows both simple bounds and cross-field comparison against game state):
{{
  "validation": {{
    "checks": [
      {{
        "id": "raisePositive",
        "logic": {{ ">": [{{ "var": "players.{{{{playerId}}}}.currentAction.raiseAmount" }}, 0] }},
        "errorMessage": "Raise amount must be greater than 0"
      }},
      {{
        "id": "raiseMustExceedCurrentBet",
        "logic": {{ "or": [
          {{ "==": [{{ "var": "game.currentBet" }}, null] }},
          {{ ">": [{{ "var": "players.{{{{playerId}}}}.currentAction.raiseAmount" }}, {{ "var": "game.currentBet" }}] }}
        ]}},
        "errorMessage": "Raise must exceed the current bet"
      }}
    ]
  }}
}}

Note the null-guard on \`game.currentBet\`: if no bet has been placed yet the field may be null, so the first check (\`== null\`) allows any positive raise to pass. Always null-guard cross-field comparisons against fields that may not yet exist in state.

**RPS example — validate choice value**:
{{
  "validation": {{
    "checks": [
      {{
        "id": "invalidChoice",
        "logic": {{ "in": [{{ "var": "players.{{{{playerId}}}}.currentAction.choice" }}, ["rock", "paper", "scissors"]] }},
        "errorMessage": "Choice must be rock, paper, or scissors"
      }}
    ]
  }}
}}

**Order matters**: First failing check determines error message returned.

## 3. Mechanics Guidance

**When to use mechanicsGuidance**: Use it whenever game mechanics require conditional logic, comparisons, or arithmetic that cannot be expressed as atomic ops:
- Scoring that depends on conditions (e.g. "if stock moved in predicted direction, score = abs(pctChange), else 0")
- Winner determination by comparing player scores ("player with higher score wins")
- Any computation that reads multiple state fields and derives a result

**How it works**: Generated mechanic code reads \`mechanicsGuidance\`, inspects live state values, and writes the results. The \`mechanicsGuidance\` block tells the code generator what logic to implement — it does not execute at instruction-extraction time.

**isGameWinner**: Generated mechanic code sets \`players.<playerId>.isGameWinner = true\` for the winning player.
- Runtime automatically computes game.winningPlayers from these flags
- For draw-only games (no winners): no op needed

**Example: scoring after data fetch (Crypto Stock Duel pattern)**
{{
  "mechanicsGuidance": {{
    "rules": [
      "If stock moved in predicted direction (UP and pctChange > 0, or DOWN and pctChange < 0): roundScore = Math.abs(pctChange)",
      "If stock moved opposite to predicted direction: roundScore = 0",
      "After computing both scores: the player with the higher roundScore wins (set isGameWinner=true); equal scores = tie (no winner, leave isGameWinner false)"
    ],
    "computation": "For each player: read selectedDirection and the fetched pctChange from state. Compute roundScore and write to players.player1.roundScore and players.player2.roundScore. Then compare scores, determine winner or tie, and set isGameWinner accordingly. If tie, skip the isGameWinner op."
  }}
}}

**Example: RPS winner determination (classic pattern)**
{{
  "mechanicsGuidance": {{
    "rules": [
      "Rock beats scissors",
      "Scissors beats paper",
      "Paper beats rock",
      "If both players choose the same option, the round is a tie (no winner)"
    ],
    "computation": "Compare player choices to determine winner, then increment winner's score by 1 (or no change if tie)"
  }}
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

**illegalActionCount** (number) - Tracks invalid/illegal action attempts:
- Increment on validation failures
- Initialize to 0 in initialization transitions
- Example: {{ "op": "increment", "path": "players.{{{{playerId}}}}.illegalActionCount", "value": 1 }}

**Game Completion Fields (CRITICAL - Required for ALL games)**:

**players.{{{{playerId}}}}.isGameWinner** (boolean) - Set by generated mechanic code for the winning player(s).
- Runtime automatically computes game.winningPlayers from these flags
- Do NOT include game.gameEnded or game.currentPhase — the router sets these automatically

**State cleanup**: If planner hints indicate fields should be cleared/reset 
(e.g., "clear both players' choice fields"), use delete ops or set to null as specified

**⚠️ CRITICAL: The Transition From "init" Phase (typically "initialize_game")**

**⛔ mechanicsGuidance is STRICTLY FORBIDDEN for init-phase transitions.** The runtime applies init
stateDelta ops directly without a sandbox mechanic. Express ALL initialization — including random
dice rolling — as stateDelta ops only. Do NOT include a mechanicsGuidance block.

**If the game uses dice arrays** (e.g. rolling N personal dice per player), always also set an explicit
per-player count field alongside the array — validation checks read the count field directly, not array length:
{{ "op": "setForAllPlayers", "field": "diceCount", "value": 5 }}

**Setting actionRequired for a random starting player (REQUIRED pattern)**:
Use \`setForRandomPlayer\` — it picks one player at random and sets the given field on their state.
Always pair it with a prior \`setForAllPlayers\` to reset all players first:
{{ "op": "setForAllPlayers", "field": "actionRequired", "value": false }}
{{ "op": "setForRandomPlayer", "field": "actionRequired", "value": true }}

This ensures exactly one player has \`actionRequired: true\` after init.

**Recording which player was randomly chosen** (use when the game needs to reference the starting player):
Add the optional \`recordTo\` field to write the chosen player's alias (e.g. "player1") to a game-state path.
This alias can then be referenced in message templates:
{{ "op": "setForRandomPlayer", "field": "actionRequired", "value": true, "recordTo": "game.roundStartingPlayerId" }}

After this op, \`game.roundStartingPlayerId\` will contain "player1" or "player2" and can be used in templates:
\`"template": "{{game.roundStartingPlayerId}} goes first!"\`

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
        "logic": {{ "==": [{{ "var": "game.currentPhase" }}, "choice"] }},
        "errorMessage": "Cannot submit choice - not in choice phase"
      }},
      {{
        "id": "notYourTurn",
        "logic": {{ "==": [{{ "var": "players.{{{{playerId}}}}.actionRequired" }}, true] }},
        "errorMessage": "It is not your turn"
      }},
      {{
        "id": "invalidChoice",
        "logic": {{ "in": [{{ "var": "players.{{{{playerId}}}}.currentAction.choice" }}, ["rock", "paper", "scissors"]] }},
        "errorMessage": "Choice must be rock, paper, or scissors"
      }}
    ]
  }},
  "stateDelta": [
    {{ "op": "set", "path": "players.{{{{playerId}}}}.currentAction.type", "value": "submit-choice" }},
    {{ "op": "set", "path": "players.{{{{playerId}}}}.currentAction.choice", "value": "{{{{input.choice}}}}" }}
  ],
  "messages": {{
    "private": [
      {{ "to": "{{{{playerId}}}}", "template": "Choice recorded: {{{{input.choice}}}}" }}
    ],
    "public": {{ "template": "{{{{playerName}}}} has submitted their choice" }}
  }}
}}

# Example Initialization Transition (With RNG)

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
}}`;
