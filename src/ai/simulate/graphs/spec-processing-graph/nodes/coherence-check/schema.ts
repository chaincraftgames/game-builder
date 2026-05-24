/**
 * Coherence Check Schema
 *
 * Shared types for the coherence-check node and the repair-artifacts coordinator.
 * Defines the structured findings the coherence checker LLM returns, and the
 * summary of a single mechanic's field I/O used as input to the check.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// MechanicFieldIo — extracted read/write summary for one mechanic
// ---------------------------------------------------------------------------

export const MechanicFieldIoSchema = z.object({
  mechanicId: z.string().describe(
    "Transition or player-action ID this mechanic implements (e.g. 'weapons_submitted', 'submit_weapons')"
  ),
  readsFields: z.array(z.string()).describe(
    "Dot-paths read via getGame/getPlayer (e.g. 'game.rpsAssignments', 'players.*.currentAction')"
  ),
  writesFields: z.array(z.string()).describe(
    "Dot-paths written via setGame/setPlayer (e.g. 'game.allWeaponsCreated', 'players.*.weapons')"
  ),
});

export type MechanicFieldIo = z.infer<typeof MechanicFieldIoSchema>;

// ---------------------------------------------------------------------------
// CoherenceIssue — a single finding from the coherence checker
// ---------------------------------------------------------------------------

/**
 * Issue types the coherence checker detects.
 *
 * circular_gate:
 *   A transition precondition requires field F, but F is only ever written by
 *   the mechanic that fires when that transition fires. The transition can never
 *   fire because the mechanic that sets the flag only runs after the transition.
 *
 * wrong_read_source:
 *   A mechanic reads from a durable schema field (e.g. players.*.weapons) but
 *   that field is empty at the time the mechanic runs — the player data lives
 *   only in currentAction (set by the preceding player-input phase). The mechanic
 *   must read from currentAction and optionally persist to the durable field.
 *
 * missing_write:
 *   A transition precondition or mechanic logic references a field that is never
 *   written by any mechanic or stateDelta in the artifact set.
 *
 * stale_read:
 *   A mechanic reads a field that should have been cleared/reset in a prior phase
 *   but was not. The read may return a value from a previous round or turn.
 *
 * missing_player_notification:
 *   An automatic transition leads into a player-input phase but sends no public or
 *   private message telling players what action to take. Players are asked to act
 *   but receive no instructions. Also applies when the init transition completes
 *   without sending a public message announcing the game has started.
 *
 * type_mismatch_in_comparison:
 *   A JsonLogic expression in a transition precondition or player-action validation check
 *   uses a numeric comparison operator (<, <=, >, >=) against a schema field whose declared
 *   type is not number/integer (e.g. record, array, boolean, string). JsonLogic coerces
 *   non-numeric types to NaN, so the comparison always evaluates to false, silently
 *   blocking the transition or always rejecting the player action.
 *
 * unreachable_competing_transition:
 *   Two transitions T1 and T2 share the same fromPhase. T2's preconditions check a field F
 *   that is only ever written by T1's mechanic — no mechanic from any other phase writes F.
 *   Once T1 fires and transitions away from the shared phase, T2 can never be evaluated.
 *
 * other:
 *   Any cross-artifact inconsistency not covered by the above types.
 */
export const CoherenceIssueTypeSchema = z.enum([
  "circular_gate",
  "wrong_read_source",
  "missing_write",
  "stale_read",
  "missing_player_notification",
  "type_mismatch_in_comparison",
  "unreachable_competing_transition",
  "other",
]);

export type CoherenceIssueType = z.infer<typeof CoherenceIssueTypeSchema>;

/**
 * Confidence levels — how certain the checker is that this is a real problem.
 *
 * confirmed: The checker is certain this will fail at runtime (e.g. a circular_gate
 *            where the only write to field F is in the mechanic for the transition
 *            that requires F). Block simulation, repair immediately.
 * probable:  The checker is fairly confident this is a real problem but there may be
 *            edge cases it cannot see from artifact text alone. Queue for repair.
 * possible:  The pattern matches a known issue type but the checker cannot confirm
 *            it will fail at runtime. Flag for human review; do not auto-consume
 *            repair budget.
 */
export const CoherenceIssueConfidenceSchema = z.enum(["confirmed", "probable", "possible", "vetoed"]);

export type CoherenceIssueConfidence = z.infer<typeof CoherenceIssueConfidenceSchema>;

export const CoherenceIssueSchema = z.object({
  reasoning: z.string().describe(
    "Step-by-step analysis of the suspected issue. Trace the read/write chain, check each condition. " +
    "If your analysis concludes the behavior is actually correct, state that clearly here and set confidence to 'vetoed'."
  ),
  issueType: CoherenceIssueTypeSchema,
  confidence: CoherenceIssueConfidenceSchema,
  affectedArtifacts: z.array(
    z.enum(["schema", "transitions", "instructions", "mechanics"])
  ).describe("Artifacts that need to be repaired to fix this issue"),
  rootCauseArtifact: z.enum(["schema", "transitions", "instructions", "mechanics"]).describe(
    "The single artifact that is the root cause (should be repaired first)"
  ),
  affectedIds: z.array(z.string()).describe(
    "Specific IDs relevant to this issue: transition IDs, field names, mechanic IDs, action IDs"
  ),
  description: z.string().describe(
    "Concise explanation of the problem and why it will fail at runtime. If vetoed, explain why the pattern is actually correct."
  ),
});

export type CoherenceIssue = z.infer<typeof CoherenceIssueSchema>;

// ---------------------------------------------------------------------------
// CoherenceCheckOutput — full output of the coherence check node
// ---------------------------------------------------------------------------

export const CoherenceCheckOutputSchema = z.object({
  hasIssues: z.boolean().describe(
    "true if any critical or warning issues were found"
  ),
  issues: z.array(CoherenceIssueSchema).describe(
    "All detected cross-artifact issues, ordered by severity (critical first)"
  ),
});

export type CoherenceCheckOutput = z.infer<typeof CoherenceCheckOutputSchema>;
