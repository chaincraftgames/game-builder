/**
 * Coordinator Node
 *
 * Analyzes validation errors and produces a structured ChangePlan.
 * The coordinator reasons about WHAT to fix, not HOW — domain-specific
 * knowledge (stateDelta syntax, JsonLogic, etc.) stays in the editor nodes.
 */

import type { ModelWithOptions } from '#chaincraft/ai/model-config.js';
import { ChangePlanSchema } from '../../types.js';
import type { ChangePlan, CoordinatorInput } from '../../types.js';
import type { ArtifactEditorStateType } from '../../artifact-editor-state.js';
import { COORDINATOR_SYSTEM_PROMPT } from './prompts.js';

// ─── System Prompt Builder ───

export function buildCoordinatorSystemPrompt(state: ArtifactEditorStateType): string {
  // Build instruction coverage summary
  const transInstr = state.transitionInstructions;
  const playerInstr = state.playerPhaseInstructions;

  let instructionCoverage: string;
  const transKeys = Object.keys(transInstr || {});
  const playerKeys = Object.keys(playerInstr || {});

  if (transKeys.length === 0 && playerKeys.length === 0) {
    instructionCoverage = 'EMPTY — no transition instructions and no player phase instructions generated';
  } else {
    const parts: string[] = [];
    parts.push(transKeys.length > 0
      ? `Transition instructions: ${transKeys.join(', ')}`
      : 'Transition instructions: EMPTY');
    parts.push(playerKeys.length > 0
      ? `Player phase instructions: ${playerKeys.join(', ')}`
      : 'Player phase instructions: EMPTY');
    instructionCoverage = parts.join('\n');
  }

  // Build transitions summary
  let transitionsSummary: string;
  try {
    const transitions = typeof state.stateTransitions === 'string'
      ? JSON.parse(state.stateTransitions)
      : state.stateTransitions;
    const phases = transitions.phases?.join(', ') || 'unknown';
    const transIds = transitions.transitions?.map((t: any) =>
      `${t.id} (${t.fromPhase} → ${t.toPhase})`
    ).join('\n  ') || 'unknown';
    transitionsSummary = `Phases: ${phases}\nTransitions:\n  ${transIds}`;
  } catch {
    transitionsSummary = state.stateTransitions || 'unknown';
  }

  // Use remainingErrors on retry, initial errors on first attempt
  const errorsToFix = state.remainingErrors.length > 0
    ? state.remainingErrors
    : state.errors;

  // Include edit failures from the previous pass so coordinator can adapt strategy
  const editFailuresSection = state.editFailures && state.editFailures.length > 0
    ? `\nPREVIOUS EDIT FAILURES (these changes were attempted but FAILED — choose a different strategy):\n${state.editFailures.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n`
    : '';

  return `${COORDINATOR_SYSTEM_PROMPT}

## Current Task

GAME SPECIFICATION:
${state.gameSpecification}

VALIDATION ERRORS:
${errorsToFix.map((e, i) => `${i + 1}. ${e}`).join('\n')}
${editFailuresSection}
CURRENT ARTIFACTS:
Schema fields: ${state.schemaFields}

${transitionsSummary}

Instruction coverage: ${instructionCoverage}

Produce a ChangePlan to resolve all validation errors.`;
}

export async function invokeCoordinator(
  model: ModelWithOptions,
  input: CoordinatorInput,
): Promise<ChangePlan> {
  const systemPrompt = buildCoordinatorSystemPrompt({
    gameSpecification: input.gameSpecification,
    errors: input.validationErrors,
    schemaFields: input.schemaFields,
    stateSchema: '',
    stateTransitions: input.stateTransitions,
    playerPhaseInstructions: input.playerPhaseInstructions === '{}'
      ? {}
      : JSON.parse(input.playerPhaseInstructions),
    transitionInstructions: input.transitionInstructions === '{}'
      ? {}
      : JSON.parse(input.transitionInstructions),
    changePlan: null,
    attemptNumber: 0,
    changesApplied: [],
    editFailures: [],
    remainingErrors: [],
    editSucceeded: false,
  });

  const result = await model.invokeWithSystemPrompt(
    systemPrompt,
    '',
    { agent: 'artifact-editor-coordinator' },
    ChangePlanSchema,
  );

  return result as ChangePlan;
}

// ─── Node Factory ───

/**
 * Create the coordinator node function.
 * Follows project convention: factory takes model, returns node function.
 */
export function createCoordinatorNode(model: ModelWithOptions) {
  return async (state: ArtifactEditorStateType) => {
    const systemPrompt = buildCoordinatorSystemPrompt(state);

    const changePlan = await model.invokeWithSystemPrompt(
      systemPrompt,
      '',
      { agent: 'artifact-editor-coordinator' },
      ChangePlanSchema,
    );

    console.log(`[ArtifactEditor:coordinator] Diagnosis: ${changePlan.diagnosis}`);
    console.log(`[ArtifactEditor:coordinator] Confidence: ${changePlan.confidence}`);
    console.log(`[ArtifactEditor:coordinator] Changes: ${changePlan.changes.length}`);
    changePlan.changes.forEach((c: any, i: number) => {
      console.log(`  ${i + 1}. ${c.artifact}:${c.operation} → ${c.fragmentAddress || '(full artifact)'}`);
    });

    return {
      changePlan,
      attemptNumber: state.attemptNumber + 1,
    };
  };
}
