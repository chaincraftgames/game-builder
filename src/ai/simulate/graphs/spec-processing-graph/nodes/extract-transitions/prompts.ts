/**
 * Prompts for State Transitions Extraction
 * 
 * Generates structured phase transition guide for runtime AI agent.
 */

export const planTransitionsTemplate = `
!___ CACHE:universal-planner ___!
You are creating a phase transition specification for a game.

## Core Task
Analyze the game spec and identify:
1. Game phases (distinct states the game moves through)
2. Transitions between phases (conditions that trigger phase changes)
3. Input fields each transition reads to determine if it should fire

## Critical Rules

### 1. Template Structure (MANDATORY)
Start from this initial template:
<initialTransitionsTemplate>
{initialTransitionsTemplate}
</initialTransitionsTemplate>

- MUST preserve "init" as first phase and "finished" as last phase
- Replace <FIRST_GAMEPLAY_PHASE> with actual first gameplay phase
- Do NOT create separate "setup" or "end_game" phases - merge setup into init transition
- Phases array: ["init", ...gameplay phases..., "finished"]

#### Initialize Transition Rule
The initialize_game transition MUST:
- Ensure that every field (Input or Output) has an appropriate initial value.
- Include initialization for: game fields and player fields.

### 2. Checked Fields = Inputs Only
\`checkedFields\` lists fields the transition READS to decide if it should fire.
- ✅ Include: Fields that exist BEFORE transition fires
- ❌ Never include: Fields the transition will WRITE/UPDATE
- Rule: If transition modifies a field, don't check it

Example:
- ✅ Check: game.currentPhase, game.currentRound (inputs - already exist)
- ❌ Don't check: game.winner, players[*].score (outputs - transition will set these)

### 3. Branching Requires Separate Transitions
If the spec describes conditional outcomes (IF x THEN phase_a ELSE phase_b), create separate transitions:
- ❌ Wrong: One transition with vague conditions covering multiple outcomes
- ✅ Right: Multiple transitions, each with specific mutually exclusive preconditions

Example - spec says "After round ends, continue to next round if round < 3, otherwise end game":
\`\`\`json
// Wrong: One vague transition
{{ "id": "round_done", "condition": "round complete, maybe continue" }}

// Right: Two transitions with clear conditions
{{ "id": "continue_round", "toPhase": "next_round", "preconditionHints": [{{"explain": "game.currentRound < 3"}}] }}
{{ "id": "end_game", "toPhase": "finished", "preconditionHints": [{{"explain": "game.currentRound >= 3"}}] }}
\`\`\`

### 4. Avoid Waypoint Phases
Don't create phases that only exist to trigger one automatic transition. Merge the work into a single transition.
- ❌ Wrong: phase_a → [trivial transition] → phase_b → [does actual work] → phase_c
- ✅ Right: phase_a → [does all work] → phase_c

### 5. Precondition Hints (for executor synthesis)
When writing \`explain\` text for preconditionHints, follow these rules so executor can synthesize valid JsonLogic:

✅ Use wildcard for player array checks: "players[*].actionRequired == false"
❌ Never use indexed access: "players[0].field" or "players.0.field"

For player-specific checks, write clearly so executor knows which operator to use:
- "any player has score >= 10" → executor will use anyPlayer operator
- "all players have actionRequired == false" → executor will use allPlayers operator

## Output Schema
<planningSchema>
{planningSchemaJson}
</planningSchema>

## Output Format
Return exactly two parts:
1. Brief 1-3 sentence summary of phases and transition logic
2. Single JSON object matching planning schema (example below)

\`\`\`json
{{
  "phases": ["init", "gameplay_phase_1", "gameplay_phase_2", "finished"],
  "phaseMetadataHints": [
    {{ "phase": "init", "requiresPlayerInput": false }},
    {{ "phase": "gameplay_phase_1", "requiresPlayerInput": true }},
    {{ "phase": "finished", "requiresPlayerInput": false }}
  ],
  "transitionCandidates": [
    {{
      "id": "initialize_game",
      "fromPhase": "init",
      "toPhase": "gameplay_phase_1",
      "priority": 1,
      "condition": "Game starts and initial state is set",
      "checkedFields": ["game.currentPhase"],
      "preconditionHints": [
        {{ "id": "is_init", "explain": "game.currentPhase == 'init'" }}
      ],
      "humanSummary": "Initialize game and move to first phase"
    }}
  ]
}}
\`\`\`
!___ END-CACHE ___!

!___ CACHE:design-planner ___!
## Game Specification
<specification>
{gameSpecification}
</specification>
!___ END-CACHE ___!

!___ CACHE:artifacts-planner ___!
### Field References (STRICT)
ONLY reference fields from this explicit list:
<availableFields>
{availableFields}
</availableFields>

{computedContextFields}

⛔ If a field is not in the list above, you CANNOT reference it.
!___ END-CACHE ___!

Now analyze the game specification and produce your transitions plan following the format specified above.
`;

export const executeTransitionsTemplate = `
!___ CACHE:universal-executor ___!
You are creating the final JsonLogic-based transitions specification.

## Critical Rules

### 1. Preserve Required Structure (NO ADDITIONS ALLOWED)
- MUST include init phase and initialize_game transition from plan
- MUST preserve all phases from planner output
- phases array: ["init", ...gameplay..., "finished"]
- ⚠️ CRITICAL: Do NOT add phases, transitions, or preconditions beyond what planner specified
- ⚠️ CRITICAL: Each transition must have EXACTLY the preconditions listed in planner's preconditionHints
- Your job is faithful implementation, NOT improvement or addition

### 2. Preconditions = Inputs Only
Preconditions check state that ALREADY EXISTS before transition fires.
- ✅ Check: Fields from \`checkedFields\` (what transition reads)
- ❌ Never check: Fields transition will write (outputs)

Example (round_scored transition):
- ✅ Correct: currentPhase == "scoring" AND currentRound == 1
- ❌ Wrong: Check if scores updated (transition WRITES scores!)

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

⚠️ Use ARRAY format for custom ops: ["field", "op", value], NOT object format

## Output Schema
<transitionsArtifactSchema>
{{transitionsArtifactSchemaJson}}
</transitionsArtifactSchema>

<JsonLogicSchema>
{{jsonLogicSchema}}
</JsonLogicSchema>

## Output Format
Return EXACTLY one JSON object matching TransitionsArtifactSchema:

\`\`\`json
{{
  "phases": ["init", "phase_a", "finished"],
  "phaseMetadata": [
    {{ "phase": "init", "requiresPlayerInput": false }},
    {{ "phase": "phase_a", "requiresPlayerInput": true }},
    {{ "phase": "finished", "requiresPlayerInput": false }}
  ],
  "transitions": [
    {{
      "id": "initialize_game",
      "fromPhase": "init",
      "toPhase": "phase_a",
      "checkedFields": ["game.currentPhase"],
      "preconditions": [
        {{
          "id": "is_init",
          "logic": {{"==": [{{"var": "game.currentPhase"}}, "init"]}},
          "deterministic": true,
          "explain": "Check if in init phase"
        }}
      ],
      "humanSummary": "Initialize and start game"
    }}
  ]
}}
\`\`\`
!___ END-CACHE ___!

!___ CACHE:design-executor ___!
### Field References (STRICT)
ONLY reference fields from this list in JsonLogic \`var\` expressions:
<availableFields>
{availableFields}
</availableFields>

{computedContextFields}

⛔ If a field is not in the list, you CANNOT use it.
!___ END-CACHE ___!

!___ CACHE:artifacts-executor ___!
## Transitions Plan
<transitionsPlan>
{transitionsPlan}
</transitionsPlan>
!___ END-CACHE ___!

Now generate the complete transitions artifact based on the planner's specification, following all rules above.
`;
