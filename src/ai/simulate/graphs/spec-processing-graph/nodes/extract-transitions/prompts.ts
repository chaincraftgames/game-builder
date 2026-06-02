/**
 * Prompts for State Transitions Extraction
 * 
 * Generates structured phase transition guide for runtime AI agent.
 */

import { TRANSITIONS_DOMAIN_KNOWLEDGE } from '#chaincraft/ai/simulate/domain-knowledge/transitions-domain-knowledge.js';

export const planTransitionsTemplate = `
!___ CACHE:universal-planner ___!
You are creating a phase transition specification for a game.

# Architecture: Two Phase Types

Understanding this separation is CRITICAL — every design decision flows from it.

## Player Input Phases (requiresPlayerInput: true)
- The runtime waits for players to submit free-text actions
- Players set **input fields**: the raw choices they made (bid count, move, challenge signal)
- Transition OUT fires when players have completed their required input
- Preconditions check: currentPhase + player readiness (e.g., allPlayersCompletedActions)
- Player input already exists when the transition fires — preconditions CAN check it

## Automatic Transition Phases (requiresPlayerInput: false)
- The engine reads input fields set by the prior player phase and computes what happened
- Sets **outcome fields**: game results (challenge winner, score delta, round loser)
- Transition OUT fires immediately to trigger that computation and advance to the next phase
- Preconditions check: ONLY currentPhase + input fields already set by a prior phase
- ⛔ NEVER precondition on values this transition will produce — they don't exist yet

## Router (system-controlled)
- Owns **game.currentPhase** and **game.gameEnded** exclusively — nothing else writes these
- Fires the first transition whose preconditions are satisfied
- Phase changes and game termination happen automatically

## Design Principle: Input Fields Enable Phase Transitions
The router checks state fields to decide when to fire a transition. If a game event
(e.g., "player declares a challenge") must trigger a phase change, there MUST be a writable
input field the router can check (e.g., game.challengerId != null). Without it, the
transition can never fire → the game deadlocks.

# Your Task
Analyze the game spec and produce:
1. A list of game phases with their type (player-input or automatic)
2. Transitions between phases, each with preconditions that reflect the phase type
3. humanSummary descriptions that tell the instruction generator what work to do

# Rules

## 1. Template Structure (MANDATORY)
Start from this initial template:
<initialTransitionsTemplate>
{initialTransitionsTemplate}
</initialTransitionsTemplate>

- MUST preserve "init" as first phase and "finished" as last phase
- Replace <FIRST_GAMEPLAY_PHASE> with actual first gameplay phase
- Do NOT create separate "setup" or "end_game" phases — merge setup into init transition
- Phases array: ["init", ...gameplay phases..., "finished"]

#### Initialize Transition
The initialize_game transition MUST set initial values for every schema field:

#### Narrative Opening Pattern
If the game requires an LLM-generated narrative opening (e.g., a dungeon crawler that needs
to set the scene, reveal a secret role, or generate atmospheric intro text), do NOT try to
produce that narrative in \`initialize_game\`. Instead:
1. \`initialize_game\` transitions from "init" to an intermediate automatic phase (e.g. "opening_scene").
2. Add a second automatic transition (e.g. \`generate_opening_scene\`) from "opening_scene" to the
   first player-input phase. This transition uses mechanicsGuidance + narrativeKeys so the generated
   mechanic can call \`callLLM\` at runtime to produce the narrative opening message.

For simple games that only need a static welcome message, \`initialize_game\` transitions directly
from "init" to the first gameplay phase and includes a static \`messages.public.template\`.
- All **input fields** (set to null/0/false/empty — no player has acted yet)
- All **outcome fields** (set to null — no outcomes computed yet)
- All player fields for every player
- game.round, game.currentTurnPlayerId, etc. — everything starts from a known state

## 2. Preconditions = Inputs Only
\`checkedFields\` and \`preconditionHints\` must only reference fields that exist BEFORE the transition fires.

- ✅ Input fields set by a prior player phase
- ✅ Computed context fields (allPlayersCompletedActions, currentPlayerTurnId, etc.)
- ❌ Fields this transition will write — they don't exist yet
- ❌ game.currentPhase, game.gameEnded — router-controlled, never in preconditions

Ask: "Does this data exist BEFORE the transition fires, or is it CREATED BY this transition?"
Created-by data belongs in the instruction's stateDelta, described in humanSummary — not preconditions.

\`\`\`json
// ❌ Wrong: precondition checks the value this transition will generate
{{
  "id": "resolve_round",
  "preconditionHints": [
    {{ "explain": "game.currentPhase == 'resolution'" }},
    {{ "explain": "game.roundWinnerId != null" }}  // ← produced BY this transition
  ]
}}

// ✅ Right: precondition checks only the input that triggered the phase
{{
  "id": "resolve_round",
  "humanSummary": "Read both players' moves, apply win rules, set roundWinnerId and update scores",
  "preconditionHints": [
    {{ "explain": "game.currentPhase == 'resolution'" }}
  ]
}}
\`\`\`

## 3. Branching = Separate Transitions, Exhaustive Coverage Required
Conditional outcomes (IF x THEN phase_a ELSE phase_b) require separate transitions with
mutually exclusive preconditions — not one vague transition.

**Exhaustive coverage is mandatory**: for every phase, every reachable game state must satisfy
at least one outgoing transition's preconditions. If no transition can fire, the game deadlocks.

After writing your branching transitions, ask: "Is there any state this phase can reach where
NONE of these transitions fire?" Common trap — final-round logic:

\`\`\`json
// ❌ Wrong — deadlocks in a tied-score final round (no one has 2 wins yet,
//    but rounds_remaining is also false because it IS the last round)
{{ "id": "continue_match", "preconditionHints": [{{"explain": "no player has 2 wins AND rounds remaining"}}] }}
{{ "id": "end_match",      "preconditionHints": [{{"explain": "a player has 2 wins"}}] }}

// ✅ Right — exhaustive: either someone has won OR it's the last round
{{ "id": "continue_match", "preconditionHints": [{{"explain": "no player has 2 wins AND rounds remaining"}}] }}
{{ "id": "end_match",      "preconditionHints": [{{"explain": "a player has 2 wins OR no rounds remaining"}}] }}
\`\`\`

\`\`\`json
// ❌ Wrong
{{ "id": "round_done", "condition": "round complete, maybe continue" }}

// ✅ Right
{{ "id": "continue_round", "toPhase": "playing", "preconditionHints": [{{"explain": "game.currentRound < game.totalRounds"}}] }}
{{ "id": "final_round_complete", "toPhase": "finished", "preconditionHints": [{{"explain": "game.currentRound >= game.totalRounds"}}] }}
\`\`\`

## 4. Avoid Waypoint Phases
Don't create phases that only exist to trigger one automatic transition.
- ❌ Wrong: phase_a → [trivial] → phase_b → [real work] → phase_c
- ✅ Right: phase_a → [all work] → phase_c

Don't add a follow-on verification phase just to confirm work completed.

## 5. Avoid Duplicate Player-Specific Phases
Use ONE parameterized phase when multiple players take the same action in sequence.

❌ Wrong: ["player1_choosing", "player2_choosing"]
✅ Right: ["choosing"] with a self-loop transition for turn rotation

\`\`\`json
{{ "id": "next_player_turn", "fromPhase": "choosing", "toPhase": "choosing",
   "preconditionHints": [{{"explain": "currentPlayerCompleted == true AND allPlayersCompleted == false"}}] }},
{{ "id": "all_players_chose", "fromPhase": "choosing", "toPhase": "resolution",
   "preconditionHints": [{{"explain": "allPlayersCompletedActions == true"}}] }}
\`\`\`

Similarly: use "scoring" + game.currentRound, not "round1_scoring", "round2_scoring".

## 6. No Timer or Timeout Transitions
Timer, timeout, deadline, and AFK-protection transitions are **NOT supported**. Do not create
any transition based on elapsed time, submission deadlines, or auto-advance after N seconds.
No wall-clock advancement mechanism exists in the runtime — such transitions will fire
immediately or never, breaking the game.

\`\`\`json
// ❌ FORBIDDEN — phaseElapsedMs, submissionDeadline, currentTime are never set; game will break
{{ "explain": "game.phaseElapsedMs >= 30000" }}
{{ "explain": "game.currentTime >= game.submissionDeadline" }}
\`\`\`

"Simultaneous submissions" means choices are hidden until all players have submitted — it does
NOT imply a timeout fallback. Do not add \`submission_timeout\` or similar transitions.

## 7. Use allPlayersCompletedActions for Simultaneous Submissions
When a transition fires after ALL players have submitted their action simultaneously, use the computed context field \`allPlayersCompletedActions\` as the precondition — do NOT invent a custom boolean signal field (e.g. \`allActionsSubmitted\`, \`allPlayersReady\`).

Custom signal fields create a **circular dependency**: the mechanic can only set them after the transition fires, but the transition won't fire until they are set → permanent deadlock.

\`allPlayersCompletedActions\` is true when every player with \`actionRequired == true\` has submitted a non-null \`currentAction\`. It is computed by the router before each transition evaluation — no mechanic needs to set it.

\`\`\`json
// ❌ Wrong — allWeaponsSubmitted is never set before this transition fires
{{ "preconditionHints": [{{"explain": "allPlayers.weaponsSubmitted == true"}}] }}

// ✅ Right
{{ "preconditionHints": [{{"explain": "allPlayersCompletedActions == true"}}] }}
\`\`\`

## 8. Precondition Hint Writing Style
When writing \`explain\` text, use these patterns so the executor synthesizes correct JsonLogic:

✅ Player array checks use wildcards: "all players have actionRequired == false"
❌ Never: "players[0].actionRequired" or "players.player1.actionRequired"

Use natural language for aggregate checks:
- "any player has score >= 10" → executor uses anyPlayer operator
- "all players have actionRequired == false" → executor uses allPlayers operator

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
⛔ Do NOT use message fields (public or private) or winner flags in preconditions. Use dedicated readiness flags or game.gameEnded instead, and set gameEnded when you set winners.
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

${TRANSITIONS_DOMAIN_KNOWLEDGE}

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
⛔ Do NOT use message fields (public or private) or winner flags in preconditions. Use readiness flags or game.gameEnded instead, and set gameEnded when you set winners.
!___ END-CACHE ___!

!___ CACHE:artifacts-executor ___!
## Transitions Plan
<transitionsPlan>
{transitionsPlan}
</transitionsPlan>
!___ END-CACHE ___!

Now generate the complete transitions artifact based on the planner's specification, following all rules above.
`;
