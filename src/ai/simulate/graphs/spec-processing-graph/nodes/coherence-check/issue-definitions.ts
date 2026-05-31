/**
 * Coherence Issue Definitions
 *
 * Single source of truth for each issue type.
 * Each entry has two fields:
 *   - detection: injected into the coherence-check prompt so the LLM knows what to look for
 *   - repair: injected into the repair coordinator ONLY for issue types found in the check output
 *
 * Usage:
 *   Checker prompt: iterates all entries, uses `detection` field
 *   Repair coordinator: filters to found issueTypes only, uses `repair` field
 *
 * NOTE: These strings are embedded into LangChain prompt templates.
 * Any literal { or } must be doubled as {{ or }} to avoid being parsed as template variables.
 * Game-runtime template vars (e.g. {{playerId}}) are already doubled and correct as-is.
 */

import type { CoherenceIssueType } from './schema.js';

export interface CoherenceIssueDefinition {
  /** Injected into the checker prompt — describes what pattern to detect */
  detection: string;
  /** Injected into the repair coordinator — describes how to fix the issue */
  repair: string;
  /**
   * When true, this issue type is detected by a deterministic pre-validator (not the LLM).
   * buildCheckerIssueSection() skips it so the LLM never attempts to detect it.
   */
  deterministic?: boolean;
}

export const COHERENCE_ISSUE_DEFINITIONS: Record<CoherenceIssueType, CoherenceIssueDefinition> = {

  circular_gate: {
    detection: `\
**circular_gate**: A transition precondition checks field F, but F is only written by
the mechanic that fires when that transition fires. The transition can never fire because
the mechanic that sets F can only run after the transition already fired — a deadlock.

Detection: Transition T has precondition {{"var": "game.someField"}} == true.
The only mechanic that writes game.someField is the mechanic for transition T itself.

Common pattern: A "readiness flag" schema field (e.g. allWeaponsCreated, allBidsPlaced)
appears in a transition precondition AND is set by that same transition's mechanic.

Root cause artifact: transitions`,

    repair: `\
**circular_gate repair** — root cause: transitions artifact

The precondition for the affected transition uses a boolean gate field that can only be
set AFTER the transition fires. Change the precondition to use the router-computed field
allPlayersCompletedActions instead. The custom boolean field may remain in the schema as
a post-transition confirmation written by the mechanic — it just must not gate the transition.

Example:
  Broken:  {{"var": "game.allWeaponsCreated"}} == true
  Correct: {{"var": "allPlayersCompletedActions"}} == true`,
  },

  wrong_read_source: {
    detection: `\
**wrong_read_source**: A mechanic reads player-submitted data from a durable schema field
(e.g. players.*.weapons, players.*.bid), but that field is empty when the mechanic runs.
Player actions write ONLY to players.{{playerId}}.currentAction — the durable field must
be populated by the mechanic itself after reading from currentAction.

Detection: Mechanic for automatic transition T reads players.*.someField.
Writes to players.*.someField are either (a) never, or (b) only by a later mechanic.
The preceding player-input phase wrote to players.*.currentAction instead.

Root cause artifact: instructions`,

    repair: `\
**wrong_read_source repair** — root cause: instructions artifact

Update the mechanicsGuidance for the affected transition. The mechanic must:
  1. Read raw values from each player's currentAction.<fieldName>
  2. If a durable schema field needs to be populated (e.g. a weapons array):
     construct the structured objects and persist them to that schema field
  3. Clear currentAction (set to null) after consuming it`,
  },

  missing_write: {
    detection: `\
**missing_write**: A transition precondition or mechanic reads field F, but F is never
written by any mechanic or stateDelta before that point in the game flow.

Detection: Field F appears in a precondition {{ "var": "..." }} or is read by a mechanic.
Scanning all writtenFields across mechanics and all stateDelta ops shows F is never written
before the phase where it is needed.

Root cause artifact: instructions or mechanics`,

    repair: `\
**missing_write repair** — root cause: instructions artifact

Identify which mechanic should logically write the missing field based on the game flow.
Add guidance to that mechanic's mechanicsGuidance in the instructions artifact describing
the write operation and when it should occur.`,
  },

  stale_read: {
    detection: `\
**stale_read**: A mechanic reads a field that carries leftover data from a previous round
or turn because it was never reset. This causes incorrect behavior in looping games.

Detection: Field F is written in phase P1 and read by mechanic M in a later phase P2,
but F is never reset/cleared between P1 and P2 across loop iterations.
The game is expected to cycle through multiple rounds or turns.

Root cause artifact: instructions`,

    repair: `\
**stale_read repair** — two sub-patterns:

**Sub-pattern A: stale field from a previous round (classic stale_read)**
  Root cause: Field F is written in one round and never cleared before the next round reads it.
  Fix: Find the mechanic that runs at the end of the phase where F was last written.
  Add guidance to reset F (set to null or its initial value) so it is fresh when the next round begins.
  Root cause artifact: instructions

**Sub-pattern B: precondition reads a field that the SAME transition's mechanic writes**
  Root cause: Preconditions evaluate BEFORE the transition's mechanic runs. If the precondition
  checks a field that the mechanic will update, it always reads the pre-mechanic (stale) value.
  Fix: The precondition belongs on a SUBSEQUENT transition, not on the transition that owns the mechanic.
  1. The transition with the mechanic gets a simpler precondition using only pre-mechanic state.
  2. A new or existing downstream transition reads the now-updated field as its precondition.
  3. This may require adding a new intermediate phase (use operation="add" for the new transition).
  Do NOT try to predict the post-mechanic value in the precondition — the phase split is the correct fix.
  Root cause artifact: transitions`,
  },

  missing_player_notification: {
    deterministic: true,
    detection: `\
**missing_player_notification**: A player-input phase is entered without any message
telling players what action to take. Or the init transition completes without a public
message announcing that the game has started.

Detection:
1. For each transition whose toPhase has requiresPlayerInput == true (a "phase-entry"
   transition): the issue is present ONLY IF ALL THREE of the following are true:
   (a) The Instructions Summary shows publicMessage: (none) AND privateMessage: (none)
   (b) The Mechanic Field I/O block for that transition shows "Sends messages: (none)"
       — i.e., neither "public" nor "private (per-player)" appears after "Sends messages:"
   (c) The transition has a mechanic (it appears in Mechanic Field I/O)
   If (b) shows "Sends messages: public" or "Sends messages: private (per-player)",
   the notification requirement is SATISFIED — do NOT flag this transition.
2. For the init transition (fromPhase == "init"): ALWAYS flag as missing_player_notification
   if the Instructions Summary shows publicMessage: (none). The init transition MUST produce
   a public message announcing the game has started and describing the first action players
   should take — the runtime requires at least one public message before the first player
   input turn.

Root cause artifact: instructions`,

    repair: `\
**missing_player_notification repair** — root cause: instructions artifact

For each affected transition, add or update the instruction's messages section:
- messages.public: A message visible to all players explaining the current phase and
  what action(s) are available. Mandatory for any transition entering a player-input phase.
- messages.private (optional): Per-player messages if different players need different
  instructions (e.g. secret roles, private hands).

For the init transition: add a public message announcing the game has started and
describing the first action players should take.`,
  },

  type_mismatch_in_comparison: {
    deterministic: true,
    // detection is unused for deterministic issues (filtered out of checker prompt)
    detection: `**type_mismatch_in_comparison**: Numeric comparison operator used against a non-number schema field (detected deterministically).`,

    repair: `\
**type_mismatch_in_comparison repair**

A validation check or transition precondition uses <=/>=/</> against a schema field typed
as record, array, boolean, or string. JsonLogic coerces these to NaN so the comparison
always returns false — player actions are always rejected or the transition never fires.

Fix (choose one based on the field's intent):
- If the check should compare against a numeric total (e.g. sum of a map), add a separate
  numeric field (e.g. game.totalDiceRemaining) and update the relevant mechanic to maintain
  it. Change the check to compare against the numeric field.
- If the mechanic already validates this constraint internally, remove the check entirely
  from playerActions[].validation.checks — it is redundant and broken.

Root cause artifact: instructions (for validation checks) or transitions (for preconditions)`,
  },

  unreachable_competing_transition: {
    deterministic: true,
    // detection is unused — this issue is always raised by the pre-validator, never the LLM
    detection: `**unreachable_competing_transition**: Two transitions share the same fromPhase. One transition's precondition checks a field that is only written by the other transition's mechanic — detected deterministically.`,

    repair: `\
**unreachable_competing_transition repair** — root cause: transitions artifact

Pattern: Transition T2 shares fromPhase with T1. T2's precondition checks field F. F is only
ever written by T1's mechanic. Once T1 fires from the shared phase, the game moves to T1.toPhase
and T2 is forever unreachable.

Fix:
  1. Keep T1 as-is — it fires first; its mechanic writes F.
  2. Change T2.fromPhase to T1.toPhase so T2 fires AFTER T1 has run and F is set.
  3. If T1.toPhase is a player-input phase, insert a new intermediate automatic phase
     between T1.toPhase and T2.toPhase (use operation="add" on the transition).
  4. Verify no other unconditional transition from T1.toPhase would preempt T2.`,
  },

  other: {
    detection: `\
**other**: Any cross-artifact inconsistency not covered by the types above.
Describe what fields or transitions are inconsistent and which artifacts are involved.
Use this type only when none of the above patterns fits.`,

    repair: `\
**other repair**: Analyze the description and affectedIds in the finding.
Identify the rootCauseArtifact and make the minimal targeted change to resolve
the inconsistency described.

Common sub-pattern — action-type routing deadlock:
  A single transition routes all player action types to the same toPhase, but different
  action types require different destination phases. The result is a deadlock where some
  action types have no valid exit path.
  Fix: Split into multiple transitions, one per action type. Each transition should have
  a precondition combining allPlayersCompletedActions AND anyPlayer.currentAction.type == "X".
  Use operation="add" to create the additional transition(s).
  Root cause artifact: transitions`,
  },
};

/**
 * Assembles the detection section for the coherence-check prompt.
 * Iterates all issue types and joins their detection strings.
 */
export function buildCheckerIssueSection(): string {
  return Object.values(COHERENCE_ISSUE_DEFINITIONS)
    .filter(def => !def.deterministic)
    .map(def => def.detection)
    .join('\n\n');
}


