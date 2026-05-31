/**
 * Prompts for Instructions Extraction
 */

import { INSTRUCTIONS_DOMAIN_KNOWLEDGE } from "#chaincraft/ai/simulate/domain-knowledge/instructions-domain-knowledge.js";

export const planInstructionsTemplate = `
!___ CACHE:universal-instructions ___!
You are a game instruction analyst planning execution paths for a turn-based game.

# Planner Output Schema
<planningSchema>
{planningSchemaJson}
</planningSchema>

# Architecture: Two Execution Paths

Understanding this separation is CRITICAL — every instruction decision flows from it.

## Player Input Phases (requiresPlayerInput: true)
- Players submit free-text actions ("rock", "I fold", "I play Fireball on the dragon")
- The runtime validates input deterministically and records what the player chose
- Instructions use: **validation.checks** (JsonLogic gates) + **stateDelta** (state operations)
- ⛔ NEVER include mechanicsGuidance — player input is deterministic, not computed

**validation.checks covers ALL deterministic pass/fail gates on player input**, including:
- Phase guard (is game in expected phase?)
- Turn order (is it this player's turn?)
- Required field presence (did they provide a value?)
- Simple bounds (is count >= 1? is faceValue 1–6?)
- **Cross-field comparisons against game state** — e.g. "new bid count must exceed current bid count" compares submitted input against an existing game state value. This is still a deterministic gate → belongs in validation.checks, NOT in a mechanic.

**Example (RPS)**:
- validation.checks: phase guard, is it your turn?, move is one of [rock/paper/scissors]
- stateDelta: set player.currentAction.type = "selectMove", player.currentAction.choice = {{input.choice}}

**Example (Auction)**:
- validation.checks: phase guard, is it your turn?, bid amount > 0, bid amount > game.currentHighestBid (cross-field comparison against game state)
- stateDelta: set player.currentAction.type = "bid", player.currentAction.amount = {{input.amount}}

**Example (Liar's Dice bid)**:
- validation.checks: phase guard, is it your turn?, faceValue 1–6, count >= 1, AND (newCount > game.currentBid.count OR (newCount == game.currentBid.count AND newFaceValue > game.currentBid.faceValue)) — the escalation rule is a cross-field comparison and belongs here
- stateDelta: set player.currentAction.type = "bid", player.currentAction.count = {{input.count}}, player.currentAction.faceValue = {{input.faceValue}}

## Automatic Transition Phases (requiresPlayerInput: false)
- The engine reads input fields set by the prior player phase and computes outcomes
- Instructions use: **mechanicsGuidance** (rules for sandbox code execution)
- ⛔ NEVER include validation.checks — router already verified preconditions before firing

**Example (RPS round resolution)**:
- mechanicsGuidance: compare both players' currentMove, apply RPS rules (rock beats scissors, etc.), set roundWinner, increment winner's score

**Example (Card game draw)**:
- mechanicsGuidance: shuffle remaining deck, draw top N cards for each player, update player.hand, update game.deck

## Router (system-controlled)
- Owns game.currentPhase and game.gameEnded exclusively — nothing else writes these
- Reads preconditions from the transitions artifact to decide when to fire a transition
- Preconditions are already verified before instructions execute — do NOT re-check them

## Design Principle: Input Captures Choice; Outcomes Compute Consequences
- **Player input actions**: Write only the raw choices the player made (input fields)
- **Automatic transitions**: Read those input fields and compute what happens (outcome fields)
- These two paths NEVER mix — outcome computation belongs in mechanicsGuidance, not validation

# Your Task

Analyze the game specification and transitions to extract semantic information needed for instruction execution.

Focus on:
- **Player input bounds**: What are valid ranges/options for each player action?
- **Outcome computation**: How are outcomes computed (scoring, win determination, resource changes)?
- **Message purposes**: Brief description of what messages should convey
- **Randomness**: Probability distributions, ranges, what values are needed

# Output Rules

1. **Player Input Actions**: Hints for validation.checks + stateDelta ONLY
   - Describe what bounds/presence/turn checks belong in validation.checks
   - Describe what state the player's input should set in stateDelta
   - NEVER include mechanicsGuidance hints for player input
2. **Automatic Transitions**: Hints for mechanicsGuidance ONLY
   - Describe rules for computing outcomes in plain English
   - NEVER include validation.checks hints (preconditions are in transitions artifact)
   - **Exception — init-phase transition** (fromPhase "init", id typically "initialize_game"): Hint stateDelta ops ONLY (rng for dice, setForAllPlayers for counts, set for game fields). NEVER hint mechanicsGuidance for this transition — the runtime applies stateDelta ops directly. This transition MUST also include a static \`messages.public.template\` — a plain-text welcome message announcing the game has started and describing the first action (e.g. "Welcome to Rock Paper Scissors! First to 2 wins — choose your sign."). Do NOT use narrativeKeys here. If the game requires an LLM-generated narrative opening, it belongs in a separate subsequent automatic transition (e.g. \`generate_opening_scene\`) that uses mechanicsGuidance + narrativeKeys — not in \`initialize_game\`.
   - **currentAction field names**: When an automatic transition follows a player-input phase, you already know the exact shape of \`currentAction\` from the stateDelta you planned for the preceding player action. **Explicitly list those field names in mechanicsGuidance** so the mechanic generator knows exactly what to read. E.g.: "Read \`currentAction.weaponIndex\` (integer 0–2) from each player's currentAction." Do NOT leave the mechanic to guess the shape from the schema — it will get it wrong.
   - **Selection from runtime-generated collections**: If a player action selects an item from a collection that was created during gameplay (items they submitted, cards they were dealt, units they built, etc.), do NOT require the player to supply an opaque internal ID. Record the player's natural input (name, description, or display value) in \`currentAction\`. Then, in the **following automatic transition's** mechanicsGuidance, describe the resolution: match the player's submitted value against the collection by name or description. The mechanic executes with full state access and can do the lookup at runtime. Players should never be required to know internal IDs generated by a prior mechanic.
3. **Message purposes**: Brief strings (null if no message needed)
4. **requiresLLMValidation/requiresLLMReasoning**: Boolean flags — set true ONLY if natural language
   interpretation is needed (e.g., "creatively describe your attack"). Most games do not need this.
5. **imageContentSpec**: ONLY include if BOTH conditions are true: (a) the game specification
   explicitly mentions generating or displaying an image, AND (b) the transition also produces
   a public message. Never set imageContentSpec on a transition that has no public message.
   If the spec does not mention image generation, leave null for ALL transitions.
6. **narrativeKeys**: List applicable narrative key name(s) for transitions that generate messages
   with narrative style/tone. Use only keys from the "Narrative Keys Available" section above.
   Omit or leave empty if the game has no narratives or this transition generates no messages.

# Critical Fields (mention in globalNotes)
- **game.gameEnded**: Router-controlled — do NOT set in stateDelta; set automatically when router transitions to "finished"
- **players.{{playerId}}.isGameWinner**: Set in automatic transitions leading to finished phase
- **players.{{playerId}}.actionRequired**: Set by mechanics ONLY — never by player action stateDelta. The router uses \`currentAction != null\` to detect a submitted action.
- **Player action stateDelta**: MUST ONLY write \`players.{{playerId}}.currentAction\`. Any other write is stripped at runtime. Persisting player choices into other fields (e.g. a \`submittedData\` or \`selectionMade\` flag) is forbidden — the mechanic in the following automatic transition reads from \`currentAction\` instead.
- **allPlayersCompletedActions**: A router-computed context field that is \`true\` when every player who has \`actionRequired == true\` has also submitted a non-null \`currentAction\`. For transitions that fire when ALL players have simultaneously submitted, the transitions artifact precondition MUST use \`{{"var": "allPlayersCompletedActions"}}\` — do NOT invent a custom boolean signal field for this purpose. Custom signal fields create a circular dependency: the mechanic can only set them after the transition fires, but the transition won't fire until they're set.
- **Signal field reset rule**: If a transition fires based on a boolean signal field (e.g. \`bothPlayersSelected: true\`), the mechanic for that transition — or the mechanic for the immediately following transition — MUST reset that signal field back to \`false\` before the game loops back to the phase that sets it. Failure to reset causes the transition to re-fire immediately on the next iteration without waiting for player input, producing an infinite loop. Always include an explicit "reset signal fields to false" step in the computation guidance for any transition that consumes a boolean signal.
- **Duplicate-submission guard**: Do NOT use \`players.{{playerId}}.currentAction.type != null\` as a validation check to prevent a player from submitting twice. By the time validation runs, \`currentAction.type\` has already been written by the current action — so this guard is always true and rejects every submission including the first. Instead, guard against double submission using a **persistent state field that the automatic mechanic writes** after successfully processing the submission (e.g., a flag or non-null field that only exists in state after the mechanic has run). That field is \`null\`/\`false\` on the first legitimate submission and set on any subsequent attempt.

Return EXACTLY one JSON object matching the schema.
!___ END-CACHE ___!

!___ CACHE:design-spec ___!
# Game Specification
<specification>
{gameSpecification}
</specification>

# Valid Data Source IDs
{validDataSourceIds}

# Valid Aggregator IDs
{validAggregatorIds}

Aggregators are composable read patterns applied to a data source. When the spec describes
comparing two readings of the same data with a delay (e.g., "read BTC price, wait 30 seconds,
read again"), use a setFromDataSource op with both dataSourceId AND aggregatorId, plus
extractField to pick the specific result field (e.g., startValue, endValue, direction).

# Narrative Keys Available
{narrativeMarkersSection}
!___ END-CACHE ___!
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
You are a game instruction generator converting high-level hints into concrete, executable instructions.

# Executor Output Schema
{executorSchemaJson}

# Architecture: Two Execution Paths

Understanding this separation is CRITICAL — it determines which output fields to generate.

## Player Input Phases (requiresPlayerInput: true) → validation.checks + stateDelta
- ⛔ NEVER include mechanicsGuidance for player input actions
- Generate **validation.checks**: JsonLogic array that deterministically gates the action
  - Checks: phase guard (game.currentPhase matches the phase), turn order (player.actionRequired == true), required input fields present, value bounds
  - If any check fails → action rejected immediately, no state change
- Generate **stateDelta**: array of state operations (set, append, increment, transfer)
  - Records the raw player choice in state fields

For RPS move selection: validation checks that the current phase is correct, it is the player's turn (player.actionRequired == true), and the submitted move is one of the valid enum values. The stateDelta uses sub-field ops: \`{{ "path": "players.{{playerId}}.currentAction.type", "value": "selectMove" }}\` and \`{{ "path": "players.{{playerId}}.currentAction.choice", "value": "{{input.choice}}" }}\`.

For a poker bet action: validation checks that the current phase is correct, it is the player's turn, and the bet amount is a positive number within the allowed range. The stateDelta uses sub-field ops: \`{{ "path": "players.{{playerId}}.currentAction.type", "value": "bet" }}\` and \`{{ "path": "players.{{playerId}}.currentAction.amount", "value": "{{input.amount}}" }}\`.

## Automatic Transition Phases (requiresPlayerInput: false) → mechanicsGuidance only
- ⛔ NEVER include validation.checks for automatic transitions
- Generate **mechanicsGuidance**: rules + computation description for sandbox execution
  - Describes how to compute outcomes from existing state
  - Router already verified all preconditions before this transition fires

For RPS round resolution: mechanicsGuidance describes comparing both players' currentMove values, applying win/loss/tie rules (rock beats scissors, scissors beats paper, paper beats rock), setting game.roundWinner (null for tie), and incrementing the winner's score.

For card game scoring: mechanicsGuidance describes summing each player's played card point values, finding the player with the highest total, and setting game.roundWinnerId to that player's ID.

**⚠️ Selection from runtime-generated collections**: If a player action selects from a collection created during gameplay (submitted items, dealt cards, built units, etc.), the player should supply a natural identifier (name, description, display value) — NOT an opaque internal ID. Record the raw player input in \`currentAction\`. In the following automatic transition's mechanicsGuidance, describe matching the submitted value against the collection by name or description. The mechanic has full state access and resolves the match at runtime.

**⚠️ currentAction bridge rule**: When an automatic transition follows a player-input phase, the mechanic must read player-submitted data from each player's \`currentAction\` field — not from any persisted schema field. Always name \`currentAction\` explicitly in mechanicsGuidance for these transitions:
- Turn-based (one player acted): "Read the submitting player's <data> from their \`currentAction.<field>\`"
- Simultaneous (all players acted): "Read each player's <data> from their \`currentAction.<field>\` — iterate all players"
Do NOT describe reading from a schema field like \`players.*.weapon\` or \`game.submissions\` — these will be empty. The submitted data lives only in \`currentAction\` until the mechanic clears it.

## Router (system-controlled)
- Owns game.currentPhase and game.gameEnded — nothing else ever writes these
- Transitions fire automatically when preconditions in the transitions artifact are met

## Field Categories
- **\`player.currentAction\`**: The single player-scoped field that holds all player input for the current action. Written by player action stateDelta. Read and cleared by automatic transition mechanics. **NEVER write to this field from an automatic transition.**
- **Game Outcome Fields**: Written by automatic transitions; never directly written by player actions (e.g., currentBidCount, roundWinner)
- **Transition Signal Fields**: Game-level fields whose value change triggers a phase transition (e.g., \`game.challengerId != null\` fires the challenge phase)

## ⚠️ CRITICAL: Player Action StateDelta Rule

**Player action stateDelta MUST write ONLY to \`players.{{playerId}}.currentAction\` sub-fields.**
**\`{{playerId}}\` is the ONLY valid template variable in any stateDelta path.** Other references like \`{{game.someField}}\`, \`{{winnerId}}\`, or \`players[N]\` are NOT resolved at runtime — they become literal keys in state (creating phantom entries). Any targeting of a player based on game state belongs in mechanicsGuidance, not stateDelta.

**⛔ FORBIDDEN**: Setting the whole \`currentAction\` object at once:
\`\`\`json
{{ "op": "set", "path": "players.{{playerId}}.currentAction", "value": {{ "type": "...", "count": ... }} }}
\`\`\`
**REQUIRED**: One separate \`set\` op per field (sub-field ops):
\`\`\`json
{{ "op": "set", "path": "players.{{playerId}}.currentAction.type", "value": "<actionId>" }}
{{ "op": "set", "path": "players.{{playerId}}.currentAction.<field1>", "value": "{{input.<field1>}}" }}
{{ "op": "set", "path": "players.{{playerId}}.currentAction.<field2>", "value": "{{input.<field2>}}" }}
\`\`\`
For actions with no input fields:
\`\`\`json
{{ "op": "set", "path": "players.{{playerId}}.currentAction.type", "value": "<actionId>" }}
\`\`\`

**NEVER write to \`game.*\` fields or any other \`players.{{playerId}}.*\` field from within a player action stateDelta.**

The automatic transition mechanic reads \`player.currentAction\`, applies game rules, writes outcome fields to \`game.*\`, and clears \`player.currentAction\` (sets to null).

**Examples with this pattern:**

For RPS move selection: the stateDelta uses sub-field ops: \`{{ "path": "players.{{playerId}}.currentAction.type", "value": "selectMove" }}\` and \`{{ "path": "players.{{playerId}}.currentAction.choice", "value": "{{input.choice}}" }}\`. Validation checks that the current phase is correct, it is the player's turn (player.actionRequired == true), and the submitted move is one of the valid enum values. **Validation checks reference the state AFTER the stateDelta is applied** — use \`players.{{playerId}}.currentAction.choice\` (NOT \`input.choice\`) in JsonLogic \`var\` paths.

For a bid action: the stateDelta uses sub-field ops: \`{{ "path": "players.{{playerId}}.currentAction.type", "value": "bid" }}\`, \`{{ "path": "players.{{playerId}}.currentAction.count", "value": "{{input.count}}" }}\`, and \`{{ "path": "players.{{playerId}}.currentAction.faceValue", "value": "{{input.faceValue}}" }}\`. Validation checks phase, turn order, count and faceValue bounds. **Use \`players.{{playerId}}.currentAction.count\` and \`players.{{playerId}}.currentAction.faceValue\`** in JsonLogic \`var\` paths — NOT \`input.count\` or \`input.faceValue\`.

For challenge (no input): validation checks phase and turn order. The stateDelta sets \`players.{{playerId}}.currentAction.type\` to \`"challenge"\`.

**⚠️ CRITICAL — validation uses applied state, NOT raw input:**
- \`{{input.*}}\` appears in stateDelta VALUE templates only — the runtime resolves those before applying
- JsonLogic \`var\` paths in validation.checks MUST use \`players.{{playerId}}.currentAction.*\` — never \`input.*\`
- Example: \`{{ "var": "players.{{playerId}}.currentAction.count" }}\` ✅ vs \`{{ "var": "input.count" }}\` ❌

# Your Task

Convert the planner's high-level hints into complete, concrete instructions for the game runtime.
Fill in all details: specific JsonLogic operators for checks, exact state operation paths for deltas,
and full rules + computation guidance for mechanics.

${INSTRUCTIONS_DOMAIN_KNOWLEDGE}
!___ END-CACHE ___!

!___ CACHE:design-executor ___!
# Game Specification Context
{gameSpecificationSummary}

# When to Use Validation vs. Mechanics

**Use validation.checks (JsonLogic) for player input — deterministic, fail-fast:**
- Phase guard (is game in expected phase?)
- Turn order (is it this player's turn?)
- Required field presence (did they provide a value?)
- Value bounds (is count in range? is move a valid option?)
- **Cross-field comparisons against game state** — comparing submitted input against existing state is still deterministic. Examples: "new bid must beat current bid" (compare submitted count/faceValue against game.currentBid.count/faceValue), "bet must exceed current highest bid" (compare submitted amount against game.highestBid). These are pass/fail gates → validation.checks, NOT mechanics.

**Use mechanicsGuidance (sandbox rules) for automatic transitions — computation:**
- Outcome resolution (who wins, how many points, what is gained/lost)
- Multi-field calculations (count resources across multiple state locations)
- Randomness (roll dice, draw cards, random selection)
- State that depends on the result of prior state (winner based on comparison)

**⚠️ Automatic transitions NEVER re-validate player input.** By the time an automatic transition fires, the player action has already passed all validation.checks. The mechanic must NOT re-check whether the player's submitted values were legal — that already happened. Read \`currentAction\` and compute outcomes from it directly.

**These paths NEVER mix**:
- A player input action NEVER has mechanicsGuidance (even if the game rule is complex — express it as JsonLogic or record the raw input for a subsequent automatic transition to resolve)
- An automatic transition NEVER has validation.checks (preconditions are verified by the router before the transition fires)

# Narrative Keys Available
{narrativeMarkersSection}

**Narrative Keys:**
If the planner hint includes \`narrativeKeys\`, carry them through unchanged to the instruction's \`narrativeKeys\` field.
The runtime looks up narrative content at execution time and injects it into the callLLM system prompt.
!___ END-CACHE ___!

!___ CACHE:artifacts-executor ___!
# ⚠️ INSTRUCTION GENERATION RULES — READ BEFORE GENERATING ⚠️

## For Player Input Actions (phases marked requiresPlayerInput: true in phaseMetadata)
- ✅ Generate "validation" with "checks" array (JsonLogic gates)
- ✅ Generate "stateDelta" array (set/append/increment/transfer ops)
- ⛔ DO NOT generate "mechanicsGuidance"
- ⛔ DO NOT write router-managed fields: game.currentPhase, game.gameEnded

## For Automatic Transitions (transitions from phases with requiresPlayerInput: false)
- ✅ Generate "mechanicsGuidance" with "rules" and "computation" fields
- ⛔ DO NOT generate "validation.checks"
- ✅ Optionally include "stateDelta" for simple ops (rng, setForAllPlayers), but put logic in mechanicsGuidance
- ⛔ DO NOT write router-managed fields: game.currentPhase, game.gameEnded

## ⛔ Special Case: Init-Phase Transition (fromPhase "init", id typically "initialize_game")
- ⛔ NEVER generate "mechanicsGuidance" — the runtime applies init stateDelta ops directly, no sandbox mechanic is run
- ✅ Use ONLY "stateDelta" ops (rng, set, setForAllPlayers, setForRandomPlayer, etc.) to express all initialization
- ✅ To assign a random starting player, use setForRandomPlayer — always preceded by setForAllPlayers to reset:
  {{ "op": "setForAllPlayers", "field": "actionRequired", "value": false }}
  {{ "op": "setForRandomPlayer", "field": "actionRequired", "value": true }}
- ✅ If the game uses dice arrays, always set an explicit per-player count field too — validation reads it directly:
  {{ "op": "setForAllPlayers", "field": "diceCount", "value": 5 }}

# ⚠️ USE THESE EXACT PHASE NAMES - DO NOT MODIFY ⚠️

{phaseNamesList}

# ⚠️ USE THESE EXACT TRANSITION IDs - DO NOT MODIFY ⚠️

{transitionIdsList}

# ⚠️ VALID DATA SOURCE IDs FOR setFromDataSource ⚠️

{validDataSourceIds}

When using setFromDataSource operations, you MUST use ONLY the exact data source IDs listed above.
Do NOT invent, abbreviate, or modify data source IDs. Copy them EXACTLY as shown.

# ⚠️ VALID AGGREGATOR IDs FOR setFromDataSource ⚠️

{validAggregatorIds}

Aggregators are optional composable read patterns. When the spec describes reading a data source
twice with a delay to compare values (e.g., "track price movement over 30 seconds"), use:
- dataSourceId: the underlying data source (e.g., "binance-btc-usd-price")
- aggregatorId: the aggregator pattern (e.g., "30s-movement")
- extractField: which field from the aggregator result (e.g., "startValue", "endValue", "direction", "delta", "pctChange")

Multiple ops can reference the same dataSourceId + aggregatorId — the aggregator executes once
and caches the result. Use different extractField values to get different parts of the result.

# CRITICAL ID MATCHING REQUIREMENTS

Your instructions[].phase field must EXACTLY match a phase name from the list above.
Your automaticTransitions[].id field must EXACTLY match a transition ID from the list above.

DO NOT create variations. COPY THE EXACT STRINGS INCLUDING CAPITALIZATION.

# State Schema
{stateSchema}

# Action Definitions
These define the exact structure of \`player.currentAction\` for each action type.
Use ONLY these action IDs and input field names in player action stateDelta.
{actionDefinitions}

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

# Image Generation

If the planner hints include an imageContentSpec for a transition, carry it through ONLY if the
transition also produces a public message (i.e., messages.public is set). Images always
accompany a message — never set imageContentSpec on a transition that has no public message.
Only include imageContentSpec when the game specification EXPLICITLY requests image generation for that moment.
Do NOT invent image generation that the spec did not ask for. If no planner hints have imageContentSpec, omit the field entirely.
This field is carried through to the runtime, where the execution LLM may use it to produce an image prompt.

Now generate the complete instructions artifact.
`;
