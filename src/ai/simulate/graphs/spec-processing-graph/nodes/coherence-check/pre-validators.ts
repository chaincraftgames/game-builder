/**
 * Coherence Check Pre-Validators
 *
 * Deterministic validators that run before the LLM coherence check.
 * Each validator performs pure static analysis (no LLM calls) and returns
 * CoherenceIssue[] findings. Results are merged into the final coherenceFindings.
 *
 * To add a new pre-validator: implement CoherencePreValidator and append it to PRE_VALIDATORS.
 *
 * NOTE: These strings are embedded into LangChain prompt templates.
 * Any literal { or } must be doubled as {{ or }} to avoid being parsed as template variables.
 */

import type { SpecProcessingStateType } from '../../spec-processing-state.js';
import type { CoherenceIssue, MechanicFieldIo } from './schema.js';
import type { GameStateField } from '../extract-schema/schema.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Pre-computed message-send information for a single mechanic. */
export interface MechanicMessageInfo {
  sendsPublic: boolean;
  sendsPrivate: boolean;
}

export interface CoherencePreValidator {
  /** Short identifier used in log output */
  name: string;
  /**
   * Run the validator and return any issues found.
   * @param state - Full spec-processing state
   * @param mechanicMessages - Pre-computed message-send info keyed by mechanicId
   * @param schemaFieldTypes - Map from "game.fieldName" / "players.*.fieldName" to FieldType
   */
  run(
    state: SpecProcessingStateType,
    mechanicMessages: Record<string, MechanicMessageInfo>,
    schemaFieldTypes: Map<string, string>,
    mechanicFieldIo: MechanicFieldIo[],
  ): CoherenceIssue[];
}

// ---------------------------------------------------------------------------
// missing_player_notification
// Detects transitions leading to requiresPlayerInput phases whose mechanics
// send no message to players, leaving them without instruction.
// ---------------------------------------------------------------------------

const missingPlayerNotificationValidator: CoherencePreValidator = {
  name: 'missing_player_notification',

  run(state, mechanicMessages, _schemaFieldTypes, _mechanicFieldIo): CoherenceIssue[] {
    const issues: CoherenceIssue[] = [];
    if (!state.stateTransitions) return issues;

    let parsed: any;
    try {
      parsed = JSON.parse(state.stateTransitions);
    } catch {
      return issues;
    }

    // Build phase → requiresPlayerInput lookup
    const phaseRequiresInput: Record<string, boolean> = {};
    for (const pm of (parsed.phaseMetadata ?? [])) {
      phaseRequiresInput[pm.phase] = pm.requiresPlayerInput ?? false;
    }

    for (const t of (parsed.transitions ?? [])) {
      // Init transitions never need a notification
      if (t.fromPhase === 'init') continue;

      // Only flag transitions entering a player-input phase
      if (!phaseRequiresInput[t.toPhase]) continue;

      // If there is no mechanic for this transition, the static check can't fire
      const msgInfo = mechanicMessages[t.id];
      if (!msgInfo) continue;

      // Notification satisfied if the mechanic sends any public or private message
      if (msgInfo.sendsPublic || msgInfo.sendsPrivate) continue;

      issues.push({
        reasoning:
          `Deterministic check: transition '${t.id}' targets phase '${t.toPhase}' which ` +
          `has requiresPlayerInput=true. Mechanic field I/O scan shows sendsPublic=false ` +
          `and sendsPrivate=false. Players will receive no instruction.`,
        issueType: 'missing_player_notification',
        confidence: 'probable',
        affectedArtifacts: ['instructions', 'mechanics'],
        rootCauseArtifact: 'instructions',
        affectedIds: [t.id, t.toPhase],
        description:
          `Transition '${t.id}' leads to player-input phase '${t.toPhase}' but its ` +
          `mechanic sends no public or private message. Players will not be told what ` +
          `action to take when this phase is entered.`,
      });
    }

    return issues;
  },
};

// ---------------------------------------------------------------------------
// type_mismatch_in_comparison
// Detects JsonLogic numeric comparison operators used against non-number schema fields.
// ---------------------------------------------------------------------------

/** Numeric comparison operators in JsonLogic */
const NUMERIC_OPS = new Set(['<', '<=', '>', '>=']);

/**
 * Walk a JsonLogic expression tree and collect all {"var": "..."} paths
 * that appear as operands of numeric comparison operators.
 */
function collectNumericComparisonVarPaths(logic: unknown): string[] {
  const paths: string[] = [];
  if (!logic || typeof logic !== 'object') return paths;
  const entries = Object.entries(logic as Record<string, unknown>);
  for (const [op, operands] of entries) {
    if (NUMERIC_OPS.has(op) && Array.isArray(operands)) {
      for (const operand of operands) {
        if (operand && typeof operand === 'object' && 'var' in (operand as object)) {
          const varPath = (operand as { var: string }).var;
          if (typeof varPath === 'string') paths.push(varPath);
        }
      }
    } else if (Array.isArray(operands)) {
      for (const child of operands) paths.push(...collectNumericComparisonVarPaths(child));
    } else if (typeof operands === 'object' && operands !== null) {
      paths.push(...collectNumericComparisonVarPaths(operands));
    }
  }
  return paths;
}

/**
 * Normalise a JsonLogic var path to the canonical map key used in schemaFieldTypes.
 * e.g. "players.player1.currentAction" → "players.*.currentAction"
 *      "game.diceRemaining" → "game.diceRemaining"
 */
function normaliseVarPath(varPath: string): string {
  return varPath.replace(/^players\.[^.]+\./, 'players.*.');
}

const typeMismatchInComparisonValidator: CoherencePreValidator = {
  name: 'type_mismatch_in_comparison',

  run(state, _mechanicMessages, schemaFieldTypes, _mechanicFieldIo): CoherenceIssue[] {
    const issues: CoherenceIssue[] = [];
    if (schemaFieldTypes.size === 0) return issues;

    // --- Check transition preconditions ---
    if (state.stateTransitions) {
      try {
        const parsed = JSON.parse(state.stateTransitions);
        for (const t of (parsed.transitions ?? [])) {
          for (const precondition of (t.preconditions ?? [])) {
            const varPaths = collectNumericComparisonVarPaths(precondition.logic);
            for (const varPath of varPaths) {
              const canonicalPath = normaliseVarPath(varPath);
              const fieldType = schemaFieldTypes.get(canonicalPath);
              if (fieldType && fieldType !== 'number') {
                issues.push({
                  reasoning:
                    `Deterministic check: schema declares '${varPath}' as type '${fieldType}'. ` +
                    `Transition '${t.id}' precondition '${precondition.id ?? '?'}' uses a numeric ` +
                    `comparison operator against this field. JsonLogic coerces '${fieldType}' to NaN, ` +
                    `so the comparison always returns false and the transition can never fire.`,
                  issueType: 'type_mismatch_in_comparison',
                  confidence: fieldType === 'string' ? 'probable' : 'confirmed',
                  affectedArtifacts: ['transitions'],
                  rootCauseArtifact: 'transitions',
                  affectedIds: [t.id, precondition.id ?? varPath, varPath],
                  description:
                    `Transition '${t.id}' precondition '${precondition.id ?? '?'}' uses a numeric ` +
                    `comparison against '${varPath}' which has schema type '${fieldType}'. ` +
                    `JsonLogic coerces this to NaN — the comparison always returns false and the transition never fires.`,
                });
              }
            }
          }
        }
      } catch {
        // unparseable transitions — skip
      }
    }

    // --- Check player action validation checks ---
    for (const [phaseId, raw] of Object.entries(state.playerPhaseInstructions ?? {})) {
      try {
        const phase = JSON.parse(raw);
        for (const action of (phase.playerActions ?? [])) {
          for (const check of (action.validation?.checks ?? [])) {
            const varPaths = collectNumericComparisonVarPaths(check.logic);
            for (const varPath of varPaths) {
              const canonicalPath = normaliseVarPath(varPath);
              const fieldType = schemaFieldTypes.get(canonicalPath);
              if (fieldType && fieldType !== 'number') {
                issues.push({
                  reasoning:
                    `Deterministic check: schema declares '${varPath}' as type '${fieldType}'. ` +
                    `Player action '${action.id}' in phase '${phaseId}' validation check ` +
                    `'${check.id ?? '?'}' uses a numeric comparison operator against this field. ` +
                    `JsonLogic coerces '${fieldType}' to NaN, so the check always fails and ` +
                    `the action is always rejected.`,
                  issueType: 'type_mismatch_in_comparison',
                  confidence: fieldType === 'string' ? 'probable' : 'confirmed',
                  affectedArtifacts: ['instructions'],
                  rootCauseArtifact: 'instructions',
                  affectedIds: [phaseId, action.id, check.id ?? varPath, varPath],
                  description:
                    `Player action '${action.id}' in phase '${phaseId}' has validation check ` +
                    `'${check.id ?? '?'}' using a numeric comparison against '${varPath}' ` +
                    `which has schema type '${fieldType}'. JsonLogic coerces this to NaN — ` +
                    `the check always fails and the action is always rejected.`,
                });
              }
            }
          }
        }
      } catch {
        // unparseable instructions — skip
      }
    }

    return issues;
  },
};

// ---------------------------------------------------------------------------
// unreachable_competing_transition
// Detects transitions that can never fire because their preconditions check
// fields only written by a competing mechanic from the same fromPhase group.
// ---------------------------------------------------------------------------

/** Extract all {"var": "..."} paths from a JsonLogic expression tree. */
function extractVarPathsFromLogic(logic: unknown): string[] {
  const paths: string[] = [];
  if (!logic || typeof logic !== 'object') return paths;
  if (Array.isArray(logic)) {
    for (const item of logic) paths.push(...extractVarPathsFromLogic(item));
    return paths;
  }
  const obj = logic as Record<string, unknown>;
  if ('var' in obj && typeof obj['var'] === 'string') {
    return [obj['var']];
  }
  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) {
      for (const item of value) paths.push(...extractVarPathsFromLogic(item));
    } else if (typeof value === 'object' && value !== null) {
      paths.push(...extractVarPathsFromLogic(value));
    }
  }
  return paths;
}

const unreachableCompetingTransitionValidator: CoherencePreValidator = {
  name: 'unreachable_competing_transition',

  run(state, _mechanicMessages, _schemaFieldTypes, mechanicFieldIo): CoherenceIssue[] {
    const issues: CoherenceIssue[] = [];
    if (!state.stateTransitions) return issues;

    let parsed: any;
    try {
      parsed = JSON.parse(state.stateTransitions);
    } catch {
      return issues;
    }

    const transitions: any[] = parsed.transitions ?? [];

    // Build mechanicWrites: mechanicId → written field paths (from pre-computed field I/O)
    const mechanicWrites = new Map<string, string[]>(
      mechanicFieldIo.map(m => [m.mechanicId, m.writesFields]),
    );

    // Group transitions by fromPhase — only groups with 2+ are interesting
    const byPhase = new Map<string, any[]>();
    for (const t of transitions) {
      if (!byPhase.has(t.fromPhase)) byPhase.set(t.fromPhase, []);
      byPhase.get(t.fromPhase)!.push(t);
    }

    for (const [, group] of byPhase) {
      if (group.length < 2) continue;

      const groupIds = new Set(group.map((t: any) => t.id));

      // Fields written by mechanics INSIDE this fromPhase group
      const writtenInsideGroup = new Set<string>();
      for (const t of group) {
        for (const f of (mechanicWrites.get(t.id) ?? [])) {
          writtenInsideGroup.add(f);
        }
      }
      if (writtenInsideGroup.size === 0) continue;

      // Fields written by mechanics OUTSIDE this fromPhase group
      const writtenOutsideGroup = new Set<string>();
      for (const [mechanicId, writes] of mechanicWrites) {
        if (!groupIds.has(mechanicId)) {
          for (const f of writes) writtenOutsideGroup.add(f);
        }
      }

      // For each T2 in the group: check if its preconditions reference fields that
      // are only written inside the group (i.e., only by a competing same-phase mechanic)
      for (const t2 of group) {
        const precondVarPaths: string[] = [];
        for (const precond of (t2.preconditions ?? [])) {
          precondVarPaths.push(...extractVarPathsFromLogic(precond.logic));
        }

        const problematicFields: string[] = [];
        const writingTransitionIds: string[] = [];

        for (const varPath of precondVarPaths) {
          // Normalise player-specific paths to wildcard form for map lookups
          const normalized = varPath.replace(/^players\.[^.]+\./, 'players.*.');
          // Skip the system-managed currentPhase field — it is always available
          if (normalized === 'game.currentPhase') continue;

          if (writtenInsideGroup.has(normalized) && !writtenOutsideGroup.has(normalized)) {
            if (!problematicFields.includes(varPath)) problematicFields.push(varPath);
            // Identify which same-group transition(s) write this field
            for (const t1 of group) {
              if (t1.id === t2.id) continue;
              if ((mechanicWrites.get(t1.id) ?? []).includes(normalized)) {
                if (!writingTransitionIds.includes(t1.id)) writingTransitionIds.push(t1.id);
              }
            }
          }
        }

        if (problematicFields.length === 0 || writingTransitionIds.length === 0) continue;

        const t1Id = writingTransitionIds[0];
        const t1 = transitions.find((t: any) => t.id === t1Id);
        const nextPhase = t1?.toPhase ?? '(unknown)';

        issues.push({
          reasoning:
            `Deterministic check: transition '${t2.id}' (fromPhase: '${t2.fromPhase}') ` +
            `preconditions check field(s) [${problematicFields.join(', ')}] which are only ` +
            `written by transition '${t1Id}' mechanic — also originating from phase '${t2.fromPhase}'. ` +
            `Once '${t1Id}' fires, the game moves to '${nextPhase}' and '${t2.id}' can never be evaluated.`,
          issueType: 'unreachable_competing_transition',
          confidence: 'confirmed',
          affectedArtifacts: ['transitions'],
          rootCauseArtifact: 'transitions',
          affectedIds: [t2.id, t1Id, ...problematicFields],
          description:
            `Transition '${t2.id}' is unreachable: it shares fromPhase '${t2.fromPhase}' ` +
            `with '${t1Id}', but its preconditions check [${problematicFields.join(', ')}] ` +
            `which are only written by '${t1Id}' mechanic. Fix: change '${t2.id}'.fromPhase ` +
            `from '${t2.fromPhase}' to '${nextPhase}' (the toPhase of '${t1Id}') so it ` +
            `evaluates after '${t1Id}' runs.`,
        });
      }
    }

    return issues;
  },
};

// ---------------------------------------------------------------------------
// Registry — add new pre-validators here
// ---------------------------------------------------------------------------

export const PRE_VALIDATORS: CoherencePreValidator[] = [
  missingPlayerNotificationValidator,
  typeMismatchInComparisonValidator,
  unreachableCompetingTransitionValidator,
];
