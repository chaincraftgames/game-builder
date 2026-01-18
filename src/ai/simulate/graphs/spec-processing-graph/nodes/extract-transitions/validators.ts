/**
 * Transitions Validators
 * 
 * Validation functions for transitions extraction process
 */

import { BaseStore } from "@langchain/langgraph";
import { SpecProcessingStateType } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/spec-processing-state.js";
import { getFromStore } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/node-shared.js";
import { PlanningResponseSchema } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-transitions/schema.js";
import { TransitionsArtifact, TransitionsArtifactSchema } from "#chaincraft/ai/simulate/schema.js";
import { JsonLogicSchema } from "#chaincraft/ai/simulate/logic/jsonlogic.js";
import extractJsonBlocks from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-transitions/extractJsonBlocks.js";
import { containsForbiddenArrayAccess, containsExplicitPlayerReference } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-transitions/utils.js";

/**
 * Validate planner output is complete and well-formed
 */
export async function validatePlanCompleteness(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string
): Promise<string[]> {
  const errors: string[] = [];

  const plannerOutput = await getFromStore(
    store,
    ["transitions", "plan", "output"],
    threadId
  );

  if (!plannerOutput || typeof plannerOutput !== 'string') {
    errors.push("Planner output is missing or not a string");
    return errors;
  }

  if (plannerOutput.trim().length === 0) {
    errors.push("Planner output is empty");
  }

  // Attempt to detect JSON planner output and run a heuristic validation
  try {
    const jsonStr = extractJsonBlocks(plannerOutput);
    if (jsonStr) {
      const maybe = JSON.parse(jsonStr);
      const parsed = PlanningResponseSchema.safeParse(maybe);
      if (parsed.success) {
        const check = validatePhaseCoverage(parsed.data);
        if (!check.ok) {
          console.warn(
            "[validatePlanCompleteness] Planner heuristic validation warnings:",
            JSON.stringify(check.errors)
          );
          // Don't fail validation, just warn
        }
      }
    }
  } catch (e) {
    // Planner likely returned NL text; skip planner precheck
  }

  return errors;
}

/**
 * Validate executor output is valid JSON and matches schema
 */
export async function validateJsonParseable(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string
): Promise<string[]> {
  const errors: string[] = [];

  const executionOutput = await getFromStore(
    store,
    ["transitions", "execution", "output"],
    threadId
  );

  if (!executionOutput) {
    errors.push("Execution output is missing");
    return errors;
  }

  try {
    const parsed = typeof executionOutput === 'string' 
      ? JSON.parse(executionOutput)
      : executionOutput;
    
    const validated = TransitionsArtifactSchema.safeParse(parsed);
    if (!validated.success) {
      errors.push(`Schema validation failed: ${JSON.stringify(validated.error.format())}`);
    }
  } catch (e: any) {
    errors.push(`JSON parsing failed: ${e.message}`);
  }

  return errors;
}

/**
 * Validate all JsonLogic preconditions are valid
 */
export async function validateJsonLogic(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string
): Promise<string[]> {
  const errors: string[] = [];

  const executionOutput = await getFromStore(
    store,
    ["transitions", "execution", "output"],
    threadId
  );

  if (!executionOutput) {
    errors.push("Execution output is missing");
    return errors;
  }

  const transitions = typeof executionOutput === 'string' 
    ? JSON.parse(executionOutput)
    : executionOutput;

  if (transitions && Array.isArray(transitions.transitions)) {
    for (const t of transitions.transitions) {
      const hints = Array.isArray(t.preconditions) ? t.preconditions : [];
      for (const h of hints) {
        // All preconditions must have logic (no null allowed)
        if (h.logic == null) {
          errors.push(
            `Transition '${t.id}', precondition '${h.id}': logic cannot be null - all preconditions must be deterministic`
          );
        } else {
          const parsed = JsonLogicSchema.safeParse(h.logic);
          if (!parsed.success) {
            errors.push(
              `Transition '${t.id}', precondition '${h.id}': invalid JsonLogic - ${JSON.stringify(parsed.error.format())}`
            );
          }
        }
      }
    }
  }

  return errors;
}

/**
 * Validate no forbidden array access patterns in JsonLogic
 */
export async function validateNoForbiddenArrayAccess(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string
): Promise<string[]> {
  const errors: string[] = [];

  const executionOutput = await getFromStore(
    store,
    ["transitions", "execution", "output"],
    threadId
  );

  if (!executionOutput) {
    errors.push("Execution output is missing");
    return errors;
  }

  const transitions = typeof executionOutput === 'string' 
    ? JSON.parse(executionOutput)
    : executionOutput;

  if (transitions && Array.isArray(transitions.transitions)) {
    for (const t of transitions.transitions) {
      const preconds = Array.isArray(t.preconditions) ? t.preconditions : [];
      for (const p of preconds) {
        if (p && p.logic) {
          const forbiddenAccess = containsForbiddenArrayAccess(p.logic);
          if (forbiddenAccess) {
            errors.push(
              `Transition '${t.id}', precondition '${p.id}': forbidden array index access ${forbiddenAccess}. ` +
              `Use 'allPlayersCompletedActions' computed property or 'players[*]' wildcard instead.`
            );
          }
        }
      }
    }
  }

  return errors;
}

/**
 * Validate no explicit player ID references in JsonLogic
 */
export async function validateNoExplicitPlayerReferences(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string
): Promise<string[]> {
  const errors: string[] = [];

  const executionOutput = await getFromStore(
    store,
    ["transitions", "execution", "output"],
    threadId
  );

  if (!executionOutput) {
    errors.push("Execution output is missing");
    return errors;
  }

  const transitions = typeof executionOutput === 'string' 
    ? JSON.parse(executionOutput)
    : executionOutput;

  if (transitions && Array.isArray(transitions.transitions)) {
    for (const t of transitions.transitions) {
      const preconds = Array.isArray(t.preconditions) ? t.preconditions : [];
      for (const p of preconds) {
        if (p && p.logic) {
          const explicitPlayerRef = containsExplicitPlayerReference(p.logic);
          if (explicitPlayerRef) {
            errors.push(
              `Transition '${t.id}', precondition '${p.id}': explicit player ID reference ${explicitPlayerRef}. ` +
              `Player IDs at runtime are UUIDs, not 'player1' or 'p1'. ` +
              `MUST use allPlayers or anyPlayer operations to check player fields. ` +
              `Example: {"anyPlayer": ["score", ">=", 3]} instead of {"var": "players.player1.score"}`
            );
          }
        }
      }
    }
  }

  return errors;
}

/**
 * Validate transition coverage (all phases have incoming/outgoing transitions)
 */
export async function validateTransitionCoverage(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string
): Promise<string[]> {
  const errors: string[] = [];

  const executionOutput = await getFromStore(
    store,
    ["transitions", "execution", "output"],
    threadId
  );

  if (!executionOutput) {
    errors.push("Execution output is missing");
    return errors;
  }

  const transitions = typeof executionOutput === 'string' 
    ? JSON.parse(executionOutput)
    : executionOutput;

  if (
    !transitions ||
    !Array.isArray(transitions.phases) ||
    !Array.isArray(transitions.transitions)
  ) {
    errors.push("Transitions artifact missing 'phases' or 'transitions' arrays");
    return errors;
  }

  const phases = transitions.phases as string[];
  const fromCounts: Record<string, number> = {};
  const toCounts: Record<string, number> = {};

  for (const t of transitions.transitions) {
    const from = String((t as any).fromPhase || (t as any).from || "");
    const to = String((t as any).toPhase || (t as any).to || "");
    fromCounts[from] = (fromCounts[from] || 0) + 1;
    toCounts[to] = (toCounts[to] || 0) + 1;
  }

  // From every phase except the last, expect at least one outgoing transition
  for (let i = 0; i < phases.length - 1; i++) {
    const phase = phases[i];
    if (!fromCounts[phase]) {
      errors.push(`No outgoing transitions from phase '${phase}'`);
    }
  }

  // To every phase except the first, expect at least one incoming transition
  for (let i = 1; i < phases.length; i++) {
    const phase = phases[i];
    if (!toCounts[phase]) {
      errors.push(`No incoming transitions to phase '${phase}'`);
    }
  }

  return errors;
}

/**
 * Validate no non-deterministic preconditions
 */
export async function validateDeterministicPreconditions(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string
): Promise<string[]> {
  const errors: string[] = [];

  const executionOutput = await getFromStore(
    store,
    ["transitions", "execution", "output"],
    threadId
  );

  if (!executionOutput) {
    errors.push("Execution output is missing");
    return errors;
  }

  const transitions = typeof executionOutput === 'string' 
    ? JSON.parse(executionOutput)
    : executionOutput;

  if (transitions && Array.isArray(transitions.transitions)) {
    for (const t of transitions.transitions) {
      const preconds = Array.isArray(t.preconditions) ? t.preconditions : [];
      for (const p of preconds) {
        // Check for non-deterministic preconditions
        if (p && (p.deterministic === false || p.logic === null)) {
          errors.push(
            `Transition '${t.id}', precondition '${p.id}': non-deterministic preconditions are not allowed. ` +
            `All preconditions must have valid JsonLogic.`
          );
        }
      }
    }
  }

  return errors;
}

// Helper: validate a planning-like artifact (either planner JSON or final transitions).
function validatePhaseCoverage(artifact: any): {
  ok: boolean;
  errors: string[];
  nonDeterministicHints: Array<any>;
} {
  const errors: string[] = [];
  const nonDeterministicHints: Array<any> = [];

  if (!artifact || !Array.isArray(artifact.phases)) {
    errors.push("Missing or invalid `phases` array");
    return { ok: false, errors, nonDeterministicHints };
  }

  const phases = artifact.phases as string[];
  if (phases.length === 0) {
    errors.push("No phases detected");
    return { ok: false, errors, nonDeterministicHints };
  }

  // Validate required special phases
  if (phases[0] !== "init") {
    errors.push("First phase must be 'init'");
  }
  if (phases[phases.length - 1] !== "finished") {
    errors.push("Last phase must be 'finished'");
  }

  // Determine which transition array to inspect
  const candidates = Array.isArray(artifact.transitionCandidates)
    ? artifact.transitionCandidates
    : Array.isArray(artifact.transitions)
    ? artifact.transitions
    : [];

  const fromCounts: Record<string, number> = {};
  const toCounts: Record<string, number> = {};

  for (const c of candidates) {
    const from = String((c as any).fromPhase || (c as any).from || "");
    const to = String((c as any).toPhase || (c as any).to || "");
    if (from) fromCounts[from] = (fromCounts[from] || 0) + 1;
    if (to) toCounts[to] = (toCounts[to] || 0) + 1;

    const preconds = Array.isArray((c as any).preconditions)
      ? (c as any).preconditions
      : Array.isArray((c as any).preconditionHints)
      ? (c as any).preconditionHints
      : [];
    for (const p of preconds) {
      if (p && (p.deterministic === false || !p.explain)) {
        nonDeterministicHints.push({ candidate: c.id, hint: p.id });
      }
    }
  }

  // Check coverage
  for (let i = 0; i < phases.length - 1; i++) {
    const phase = phases[i];
    if (!fromCounts[phase])
      errors.push(`No outgoing transition from phase '${phase}'`);
  }
  for (let i = 1; i < phases.length; i++) {
    const phase = phases[i];
    if (!toCounts[phase])
      errors.push(`No incoming transition to phase '${phase}'`);
  }
  
  // Validate special phases
  if (!fromCounts["init"]) {
    errors.push("No transition from 'init' phase (initialize_game required)");
  }
  if (!toCounts["finished"]) {
    errors.push("No transition to 'finished' phase (game-ending transition required)");
  }

  return { ok: errors.length === 0, errors, nonDeterministicHints };
}
