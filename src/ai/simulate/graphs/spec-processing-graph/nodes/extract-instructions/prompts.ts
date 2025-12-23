/**
 * Prompts for Instructions Extraction
 *
 * Generates phase instructions with templated stateDelta operations and mechanics guidance.
 */

export const planInstructionsTemplate = `
# ⚠️ USE THESE EXACT PHASE NAMES - DO NOT MODIFY ⚠️

{phaseNamesList}

# ⚠️ USE THESE EXACT TRANSITION IDs - DO NOT MODIFY ⚠️

{transitionIdsList}

# CRITICAL INSTRUCTIONS

Your output MUST use ONLY the phase names and transition IDs listed above.
- Copy them CHARACTER-FOR-CHARACTER (including capitalization, underscores, hyphens)
- DO NOT create variations like "choice" instead of "choicePhase"
- DO NOT create variations like "both-submitted" instead of "both_players_submitted"
- Your phaseInstructions[].phase field must EXACTLY match a phase name from the list above
- Your automaticTransitions[].id field must EXACTLY match a transition ID from the list above

---

You are analyzing a game specification and transitions to identify what instructions are needed for each phase.

Game Specification:
<specification>
{gameSpecification}
</specification>

Transitions Artifact (for reference - IDs already extracted above):
<transitions>
{transitionsArtifact}
</transitions>

State Schema:
<schema>
{stateSchema}
</schema>

Planner Output Schema:
<planningSchema>
{planningSchemaJson}
</planningSchema>

Your task: Identify player actions and automatic transitions that need instructions 
for runtime execution.

# CRITICAL INSTRUCTION STRUCTURE

Instructions are separated by type:

1. **Player Phase Instructions** (playerPhases array):
   - Generate ONLY for phases that require player input
   - Keyed by phase name
   - Contains player action handling logic
   
2. **Transition Instructions** (transitions array):
   - Generate for EVERY automatic transition
   - Keyed by transition ID (not phase name!)
   - Contains transition execution logic

Phases without player input should have NO phase instructions - only their outgoing
transitions have instructions.

Example for RPS:
- choice_submission phase: HAS phase instructions (player submits choice)
- round_resolution phase: NO phase instructions (only transitions have instructions)
  * game_won transition: HAS instructions
  * round_resolved_continue transition: HAS instructions

Instructions Overview:
- Instructions are templates that tell the LLM HOW to handle player actions and 
  automatic state transitions
- Each instruction contains:
  * Validation rules (JsonLogic preconditions for deterministic checks)
  * Mechanics guidance (natural language rules like "rock beats scissors")
  * Templated stateDelta operations (with {{variables}} the LLM must resolve)
  * Message templates (with {{variables}} for player names, choices, outcomes)
  
- At runtime, the LLM will:
  1. Read the instruction template
  2. Apply mechanics rules to current game state
  3. Resolve {{template}} variables to literal values
  4. Return concrete stateDelta operations and messages

Your Role (Planner):
- Identify WHAT instructions are needed (don't generate the actual templates yet)
- For each action/transition, describe:
  * What needs validation (can it be JsonLogic or needs LLM?)
  * What game mechanics apply (trump rules, scoring logic, win conditions)
  * What state changes are needed
  * What messages players should receive
  * What template variables the LLM must resolve
  * Whether randomness is involved

Output Contract:
Return EXACTLY a JSON object matching the planning schema structure.

Rules & Guidance:

1. Player Phase Coverage:
   - Provide hints ONLY for phases that require player input (check phaseMetadata)
   - Phases without player input should NOT appear in playerPhases array
   - These phases get their execution logic from their transition instructions instead

2. Player Actions (for phases requiring player input):
   - Identify all actions players can take (submit move, vote, play card, etc.)
   - Consider validation:
     * Can validation be checked with JsonLogic? (phase, turn order, has resources, input format)
     * Does payload need LLM validation? (free text, strategy verification)
   - Consider mechanics:
     * Simple actions (submit choice, confirm ready) rarely need mechanics
     * Complex actions (play card, make trade) may involve rules
   - Template variables:
     * Always include: playerId, input fields (choice, moveData, etc.)
     * Often include: playerName for messages
   
3. Automatic Transitions:
   - Create EXACTLY ONE instruction hint per AUTOMATIC transition in transitions artifact
   - Use exact transition ID from artifact as the instruction key (see critical requirements at top)
   - Set 'basedOnTransition' to same ID for validation
   - These instructions are keyed by TRANSITION ID, not by phase name
   - Identify what each transition DOES (not just when it triggers)
   - If multiple game actions happen during a transition (e.g., score + advance), combine into one instruction
   - DO NOT create additional transitions - use only the IDs from the artifact
   - Trigger: reference the transition's preconditions from artifact
   - Computation: What must be calculated?
     * Deterministic: simple counters, flags, phase changes (no LLM)
     * LLM-driven: winner determination, scoring with complex rules, narrative outcomes
   - Mechanics guidance: THIS IS CRITICAL
     * For any transition involving game rules (scoring, winners, trump, combat):
       Describe the rules in natural language as ordered steps
       Example: ["Rock beats scissors", "Scissors beats paper", "Paper beats rock"]
     * For random events: describe probability distributions and how to apply them
   - Template variables:
     * What values must LLM compute? (winnerId, score changes, event outcomes)
     * What state values are needed in messages? (player names, choices, results)

4. Mechanics Descriptions (Key Guidance):
   - Keep rules ordered and unambiguous
   - Use concrete examples when helpful
   - For trump/hierarchy: list precedence explicitly
   - For probability: specify ranges and distributions
   - For complex logic: break into numbered steps
   
5. Randomness:
   - Use "rng" stateDelta operations for random value selection
   - Define choices array and probabilities array (must sum to 1.0)
   - **CRITICAL**: Each RNG operation generates ONE value only
   - To generate multiple random values, use multiple separate RNG operations
   - Examples:
     * Single value: {{ "op": "rng", "path": "game.mood", "choices": ["calm", "tense", "chaotic"], "probabilities": [0.33, 0.33, 0.34] }}
     * Boolean with bias: {{ "op": "rng", "path": "game.specialEvent", "choices": [true, false], "probabilities": [0.05, 0.95] }}
     * Numeric range: {{ "op": "rng", "path": "game.value", "choices": [1, 2, 3, 4, 5, 6], "probabilities": [0.167, 0.167, 0.166, 0.167, 0.167, 0.166] }}
     * Multiple values: Use separate operations to different paths or append to array
   - Router will handle RNG execution before passing instructions to LLM

6. Required State Fields:
   - List dot-notation paths the LLM will need to read
   - These are for DOCUMENTATION only (full state always provided at runtime)
   - Be thorough but don't overthink it

7. Messaging:
   - Nearly all actions/transitions need messages
   - Private: player-specific confirmations, secret info
   - Public: announcements all players see
   - Describe PURPOSE not exact wording (executor will create templates)

Example Player Action Hint:
{{
  "id": "submit-choice",
  "actionName": "Submit Choice",
  "description": "Player submits their RPS choice (rock/paper/scissors)",
  "stateChanges": ["set player choice", "set submitted flag"],
  "validationNeeded": {{
    "hasJsonLogicValidation": true,
    "validationDescription": "Check phase is 'choice', player hasn't submitted yet, choice is valid",
    "needsLLMValidation": false
  }},
  "mechanicsDescription": null,
  "messaging": {{
    "needsPrivateMessage": true,
    "privateMessagePurpose": "Confirm choice to player",
    "needsPublicMessage": true,
    "publicMessagePurpose": "Announce player has submitted (without revealing choice)"
  }},
  "templateVariables": ["playerId", "input.choice", "playerName"],
  "requiredInputFields": ["game.phase", "players.*.choice"],
  "requiredOutputFields": ["players.{{playerId}}.choice", "players.{{playerId}}.actionRequired"]
}}

Example Automatic Transition Hint (with mechanics):
{{
  "id": "choices-complete",
  "transitionName": "Choices Complete",
  "description": "Determine winner based on RPS rules and update scores when both players submitted",
  "trigger": {{
    "isDeterministic": true,
    "triggerDescription": "Both players have submitted choices",
    "basedOnTransition": "choices-complete"
  }},
  "computationNeeded": {{
    "isDeterministic": false,
    "computationDescription": "Apply RPS trump rules to determine winner",
    "requiresLLMReasoning": true,
    "llmReasoningDescription": "Compare choices using RPS rules, identify winner or tie"
  }},
  "mechanicsDescription": "Rock beats scissors. Scissors beats paper. Paper beats rock. If both choose the same, it's a tie (no score change).",
  "usesRandomness": false,
  "stateChanges": ["increment winner score", "set phase to reveal", "append to history"],
  "messaging": {{
    "needsPublicMessage": true,
    "publicMessagePurpose": "Reveal both choices and announce winner",
    "needsPrivateMessages": false
  }},
  "templateVariables": ["winnerId", "winnerName", "p1Choice", "p2Choice", "outcome"],
  "requiredInputFields": ["players.p1.choice", "players.p2.choice", "players.*.name", "game.round"],
  "requiredOutputFields": ["players.*.score", "game.currentPhase", "game.history"]
}}

Return EXACTLY one JSON object matching the InstructionsPlanningResponseSchema.

Include:
- naturalLanguageSummary: 1-3 sentences about instruction structure
- phases: EXACT list from transitions.phases array
- phaseInstructions: array with hints for each phase (using EXACT phase names)
- globalNotes: any cross-cutting patterns (optional)

---

# ⚠️ FINAL REMINDER - EXACT ID MATCHING ⚠️

Before outputting, verify:
✓ Every phase name in your output is FROM THE PHASE LIST AT THE TOP
✓ Every transition ID in your output is FROM THE TRANSITION ID LIST AT THE TOP  
✓ You copied them EXACTLY (same capitalization, underscores, hyphens)

If the phase list has "choicePhase", you MUST use "choicePhase" NOT "choice" or "choice_phase".
If the transition ID list has "both_players_submitted", you MUST use "both_players_submitted" NOT "both-submitted".

Begin output now.
`;

/**
 * Executor prompt: Generates concrete templated instructions from planner hints
 */
export const executeInstructionsTemplate = `
# ⚠️ USE THESE EXACT PHASE NAMES - DO NOT MODIFY ⚠️

{phaseNamesList}

# ⚠️ USE THESE EXACT TRANSITION IDs - DO NOT MODIFY ⚠️

{transitionIdsList}

# CRITICAL INSTRUCTIONS

Your instructions[].phase field must EXACTLY match a phase name from the list above.
Your automaticTransitions[].id field must EXACTLY match a transition ID from the list above.

DO NOT create variations. COPY THE EXACT STRINGS INCLUDING CAPITALIZATION.

---

You are generating executable game instructions from high-level hints.

Your task: Convert the planner's instruction hints into concrete, 
templated instructions that the game runtime can execute.

# Input Context

## State Schema
{stateSchema}

## Planner Hints
{plannerHints}

# Output Requirements

Generate a JSON object with complete instructions for all phases:
{executorSchemaJson}

# Key Principles

## 1. StateDelta Operations (Atomic State Changes)

ALL state changes must be expressed as atomic StateDelta operations:

**set**: Set a value at a path (REQUIRED: must include 'value' field)
{{ "op": "set", "path": "game.phase", "value": "reveal" }}
{{ "op": "set", "path": "game.publicMessage", "value": "Game starting!" }}

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
{{ "op": "rng", "path": "game.mood", "choices": ["calm", "tense", "chaotic"], "probabilities": [0.33, 0.33, 0.34] }}
{{ "op": "rng", "path": "game.specialEvent", "choices": [true, false], "probabilities": [0.05, 0.95] }}
{{ "op": "rng", "path": "game.value", "choices": [1, 2, 3, 4, 5, 6], "probabilities": [0.167, 0.167, 0.166, 0.167, 0.167, 0.166] }}
For multiple random values, use separate operations:
{{ "op": "rng", "path": "game.randomValue1", "choices": [0,1,2,3], "probabilities": [0.25,0.25,0.25,0.25] }}
{{ "op": "rng", "path": "game.randomValue2", "choices": ["A","B","C"], "probabilities": [0.5,0.3,0.2] }}

**Template Variables in Paths**: Use {{{{variableName}}}} for runtime values:
{{ "op": "set", "path": "players.{{{{playerId}}}}.choice", "value": "{{{{input.choice}}}}" }}
{{ "op": "increment", "path": "players.{{{{winnerId}}}}.score", "value": 1 }}

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

**⚠️ CRITICAL: DO NOT use stateDelta operations to set message fields!**

Use the \`messages\` section to generate player communications:
- **messages.private**: Array of private messages to specific players
- **messages.public**: Single public message visible to all players

**DO NOT** use stateDelta to set \`game.publicMessage\` or \`players.*.privateMessage\`.
The runtime automatically populates these state fields from your messages section.

**Messages structure** (part of instruction output):
{{
  "stateDelta": [
    // State changes here - NO message operations
  ],
  "messages": {{
    "private": [
      {{ "to": "{{{{playerId}}}}", "template": "You submitted {{{{input.choice}}}} for round {{{{game.round}}}}" }},
      {{ "to": "{{{{opponentId}}}}", "template": "{{{{playerName}}}} is waiting for you" }}
    ],
    "public": {{ "template": "{{{{winnerName}}}} wins round {{{{game.round}}}}! Score: {{{{p1Name}}}} {{{{p1Score}}}}, {{{{p2Name}}}} {{{{p2Score}}}}" }}
  }}
}}

**Key points:**
- \`private\`: Array of message objects, each with \`to\` (player ID template) and \`template\` (message text)
- \`public\`: Single message object with just \`template\` (goes to all players)
- Both private and public are optional
- Use {{{{variables}}}} in both \`to\` and \`template\` fields

## 5. Template Variable Patterns

Common variable patterns:
- **Player references**: playerId, playerName, winnerId, winnerName, p1Name, p2Name
- **Input data**: input.choice, input.bid, input.cardId
- **Game state**: game.round, game.phase, currentRound, nextRound
- **Outcomes**: outcome, winnerId, winnerName
- **Scores/values**: p1Score, p2Score, p1Choice, p2Choice

# Special Instructions

**Standard Player State Fields**:

**actionRequired** (boolean) - REQUIRED field, indicates if player MUST take action before game proceeds:
- Set to true when player must act (game blocks until they act)
- Set to false after player acts or when phase doesn't require player action
- Example: {{ "op": "set", "path": "players.{{{{playerId}}}}.actionRequired", "value": false }}

**actionsAllowed** (boolean) - OPTIONAL field for games with optional/voluntary actions:
- For MOST games, omit actionsAllowed operations - it will default to match actionRequired
- Only include actionsAllowed if the spec explicitly mentions optional or voluntary actions
- Use when: player can act but isn't required to (actionRequired: false, actionsAllowed: true)
- Example: {{ "op": "set", "path": "players.{{{{playerId}}}}.actionsAllowed", "value": true }}

**illegalActionCount** (number) - Tracks invalid/illegal action attempts:
- Increment on validation failures
- Initialize to 0 in initialization transitions
- Example: {{ "op": "increment", "path": "players.{{{{playerId}}}}.illegalActionCount", "value": 1 }}

**State cleanup**: If planner hints indicate fields should be cleared/reset 
(e.g., "clear both players' choice fields"), use delete ops or set to null as specified

**⚠️ CRITICAL: Initialization Transitions (initialize_game, etc.)**

When planner says "initialize X" or "set X to Y", you MUST generate explicit stateDelta operations.
Do NOT assume schema defaults - runtime requires explicit set operations.

**For ALL players** (when planner says "initialize player scores" or "set actionRequired for all players"):
Generate separate operations for {{{{player1Id}}}} and {{{{player2Id}}}} (or all player IDs in the game):
{{ "op": "set", "path": "players.{{{{player1Id}}}}.score", "value": 0 }}
{{ "op": "set", "path": "players.{{{{player2Id}}}}.score", "value": 0 }}
{{ "op": "set", "path": "players.{{{{player1Id}}}}.actionRequired", "value": true }}
{{ "op": "set", "path": "players.{{{{player2Id}}}}.actionRequired", "value": true }}

**Common initializations** planner will request:
- Player scores/counters → {{ "op": "set", "path": "players.{{{{playerNId}}}}.score", "value": 0 }}
- Action flags → {{ "op": "set", "path": "players.{{{{playerNId}}}}.actionRequired", "value": true }}
- Clear fields → {{ "op": "set", "path": "players.{{{{playerNId}}}}.currentChoice", "value": null }}
- Game counters → {{ "op": "set", "path": "game.roundNumber", "value": 1 }}
- Illegal action tracking → {{ "op": "set", "path": "players.{{{{playerNId}}}}.illegalActionCount", "value": 0 }}

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
    {{ "op": "set", "path": "players.{{{{playerId}}}}.trustLevel", "value": 0 }}
  ],
  "messages": {{
    "public": {{ "template": "You stand before the oracle. The air is thick with ancient power." }}
  }}
}}

# Example Transition With Multiple RNG Operations

{{
  "id": "setup-game",
  "transitionName": "Setup Game",
  "description": "Initialize game with multiple random selections",
  "priority": 1,
  "stateDelta": [
    {{ "op": "rng", "path": "game.startingPosition", "choices": ["north","south","east","west"], "probabilities": [0.25,0.25,0.25,0.25] }},
    {{ "op": "rng", "path": "game.weatherCondition", "choices": ["sunny","rainy","stormy"], "probabilities": [0.5,0.3,0.2] }},
    {{ "op": "rng", "path": "game.difficulty", "choices": [1,2,3], "probabilities": [0.2,0.5,0.3] }},
    {{ "op": "set", "path": "game.phase", "value": "active" }}
  ],
  "messages": {{
    "public": {{ "template": "Game initialized with starting position {{{{game.startingPosition}}}} under {{{{game.weatherCondition}}}} conditions." }}
  }}
}}

---

# ⚠️ FINAL REMINDER - EXACT ID MATCHING ⚠️

Before outputting, verify:
✓ Every phase name in your output is FROM THE PHASE LIST AT THE TOP
✓ Every transition ID in your output is FROM THE TRANSITION ID LIST AT THE TOP
✓ You copied them EXACTLY (same capitalization, underscores, hyphens)

If the phase list has "choicePhase", use "choicePhase" NOT "choice_phase".
If the ID list has "both_players_submitted", use "both_players_submitted" NOT "both-submitted".

Now generate the complete instructions artifact.
`;
