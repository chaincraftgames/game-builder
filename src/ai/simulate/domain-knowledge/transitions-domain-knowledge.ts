/**
 * Transitions Domain Knowledge
 *
 * Shared domain knowledge for transitions artifact extraction and editing.
 * Contains: Preconditions rules, deterministic preconditions (two-step RNG),
 * forbidden patterns, JsonLogic operators reference, player check solutions.
 */

export const TRANSITIONS_DOMAIN_KNOWLEDGE = `### 2. Preconditions = Inputs Only
Preconditions check state that ALREADY EXISTS before transition fires.
- ✅ Check: Fields from \`checkedFields\` (what transition reads)
- ❌ Never check: Fields transition will write (outputs)

Example (round_scored transition):
- ✅ Correct: currentPhase == "scoring" AND currentRound == 1
- ❌ Wrong: Check if scores updated (transition WRITES scores!)

**System-execution phases** (phases where the engine computes or generates something):
- Preconditions should check ONLY: currentPhase and any INPUT data from a PRIOR phase
- ❌ Never add preconditions for values this transition will produce — they don't exist yet
- If a planner hint references a value that this transition generates, move it to humanSummary/stateDelta, not a precondition

If you find yourself writing a precondition like "computed result exists" or "generated content is non-null",
that is a postcondition of this transition — it belongs in the instruction stateDelta, not here.

### 3. Deterministic Preconditions (CRITICAL)
All preconditions must be deterministic using only supported JsonLogic operations.

**Handling Randomness (Two-Step Pattern):**
If game rules require random events (e.g. dice rolls, random chance of an event occurring, 
randomly selected scenario), use TWO transitions:
1. First transition: Generate random value and STORE in state field (e.g., game.lastDiceRoll)
2. Second transition: Check stored value with deterministic logic (e.g., game.lastDiceRoll >= 4)

Example - Monster attack requires dice roll:
\`\`\`json
// Transition 1: Roll dice and store result
{{
  "id": "roll_monster_attack",
  "fromPhase": "monster_turn",
  "toPhase": "monster_turn",
  "preconditions": [{{"logic": {{"==": [{{"var": "game.currentPhase"}}, "monster_turn"]}}}}],
  "humanSummary": "Roll dice for monster attack (stores result in game.monsterAttackRoll)"
}}

// Transition 2: Check stored roll deterministically
{{
  "id": "monster_hits",
  "fromPhase": "monster_turn",
  "toPhase": "apply_damage",
  "preconditions": [{{"logic": {{">=": [{{"var": "game.monsterAttackRoll"}}, 15]}}}}],
  "humanSummary": "Monster attack hits (roll >= 15)"
}}

{{
  "id": "monster_misses",
  "fromPhase": "monster_turn",
  "toPhase": "player_turn",
  "preconditions": [{{"logic": {{"<": [{{"var": "game.monsterAttackRoll"}}, 15]}}}}],
  "humanSummary": "Monster attack misses (roll < 15)"
}}
\`\`\`

⛔ NEVER use null logic in preconditions - the router cannot evaluate non-deterministic logic.

**Allowed patterns:**
- Game-level fields: \`{{"var": "game.currentPhase"}}\`
- Computed context: \`{{"var": "allPlayersCompletedActions"}}\`
- Wildcards: Use anyPlayer/allPlayers operators (see below)
- Dynamic lookups: Use lookup operator (see below)

**Forbidden patterns:**
- ❌ Indexed access: \`players[0].field\`, \`players.0.field\`
- ❌ Dynamic player IDs: \`players[playerId].field\`
- ❌ Explicit player IDs: \`players.player1.field\`, \`players.p1.field\`, \`players.alice.field\`
- ❌ ANY direct access to specific players: \`players.<any-identifier>.field\`
- ❌ Iteration/loops in preconditions

**CRITICAL: ALL player field checks MUST use allPlayers/anyPlayer operators**

**Solution for player checks:**
Use custom anyPlayer/allPlayers operators - this is the ONLY valid way to check player fields:
\`\`\`json
// ❌ Wrong - indexed access
{{"!=": [{{"var": "players.0.selectedChoice"}}, null]}}

// ❌ Wrong - explicit player ID
{{"==": [{{"var": "players.player1.score"}}, {{"var": "players.player2.score"}}]}}

// ❌ Wrong - using aliases
{{"==": [{{"var": "players.p1.choice"}}, {{"var": "players.p2.choice"}}]}}

// ✅ Right - anyPlayer operation
{{"anyPlayer": ["selectedChoice", "!=", null]}}

// ✅ Right - allPlayers operation  
{{"allPlayers": ["score", "<", 10]}}

// ✅ Right - comparing if any two players match (when needed)
// Note: For tie detection, denormalize into game state instead
\`\`\`

**Why this matters:**
Player IDs at runtime are UUIDs, not \`player1\` or \`p1\`. Direct references like \`players.player1\` will always evaluate to \`undefined\`, causing logic errors. The allPlayers/anyPlayer operations work with ANY player ID structure.

### 4. JsonLogic Operators

**Standard operators:**
\`==\`, \`!=\`, \`>\`, \`>=\`, \`<\`, \`<=\`, \`and\`, \`or\`, \`if\`, \`!\`, \`var\`, \`in\`

**Custom operators:**

\`anyPlayer\`: True if ANY player matches condition
- Format: \`{{"anyPlayer": ["fieldName", "operator", value]}}\`
- Example: \`{{"anyPlayer": ["score", ">=", 10]}}\`
- Operators: ==, !=, >, >=, <, <=

\`allPlayers\`: True if ALL players match condition
- Format: \`{{"allPlayers": ["fieldName", "operator", value]}}\`
- Example: \`{{"allPlayers": ["actionRequired", "==", false]}}\`

\`lookup\`: Access array/object with dynamic index from state
- Format: \`{{"lookup": [collectionExpr, indexExpr]}}\`
- Example: \`{{"lookup": [{{"var": "game.choicesPerTurn"}}, {{"var": "game.currentTurn"}}]}}\`
- Use ONLY when index is dynamic. For literals use dot notation.

\`length\`: Get length of string or array
- Format: \`{{"length": valueExpr}}\`
- Example: \`{{"length": {{"var": "game.secretWord"}}}}\` returns string length
- Example: \`{{">=": [{{"length": {{"var": "game.history"}}}}, 5]}}\` checks if array has 5+ items

⚠️ CRITICAL: These are the ONLY supported operations. DO NOT invent new operations like:
- ❌ \`matches\`, \`matchesIgnoreCase\`, \`regex\` (not supported - handle validation in mutation logic instead)
- ❌ \`anyPlayerField\`, \`getPlayer\`, \`findPlayer\` (invalid - use anyPlayer/allPlayers operators)
- ❌ Any other custom operations not listed above

**For operations not supported (regex, case-insensitive comparison, etc.):**
The mutation logic will handle these validations. Your preconditions should check simpler deterministic conditions.

⚠️ Use ARRAY format for custom ops: ["field", "op", value], NOT object format`;
