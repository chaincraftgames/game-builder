/**
 * Revalidate Node
 *
 * Deterministic node (no LLM) that re-runs validation against the
 * patched artifacts to check if errors have been resolved.
 *
 * Runs three validation layers:
 *   1. Structural: validateTransitions() from validate-transitions node
 *   2. Semantic: pure validator cores from extract-instructions
 *      (deadlock detection, precondition coverage, path structure, etc.)
 *   3. Mechanics: in-memory tsc compilation of generated mechanic code
 */

import {
  validateTransitions,
} from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/validate-transitions/index.js';
import {
  validatePathStructureCore,
  validatePreconditionsCanPassCore,
  validateActionRequiredSetCore,
  validateArtifactStructureCore,
  validateSelfBlockingTransitionsCore,
  validateInitialStatePreconditionsCore,
  validateGameCompletionCore,
  validatePhaseConnectivityCore,
} from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-instructions/validator-cores.js';
import type { InstructionsArtifact, TransitionsArtifact } from '#chaincraft/ai/simulate/schema.js';
import type { SpecProcessingStateType } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/spec-processing-state.js';
import { validateMechanics } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/generate-mechanics/tsc-validator.js';
import type { ArtifactEditorStateType } from '#chaincraft/ai/simulate/graphs/artifact-editor-graph/artifact-editor-state.js';

/**
 * Build an InstructionsArtifact from editor state fields.
 */
function buildInstructionsArtifact(state: ArtifactEditorStateType): InstructionsArtifact {
  return {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    playerPhases: (state.playerPhaseInstructions ?? {}) as InstructionsArtifact['playerPhases'],
    transitions: (state.transitionInstructions ?? {}) as InstructionsArtifact['transitions'],
    metadata: {
      totalPlayerPhases: Object.keys(state.playerPhaseInstructions ?? {}).length,
      totalTransitions: Object.keys(state.transitionInstructions ?? {}).length,
      deterministicInstructionCount: 0,
      llmDrivenInstructionCount: 0,
    },
  };
}

/**
 * Create the revalidate node function.
 *
 * Maps ArtifactEditorState → SpecProcessingState shape for structural validation,
 * then runs semantic validator cores directly against the artifacts.
 */
export function createRevalidateNode() {
  return async (state: ArtifactEditorStateType) => {
    console.log(`[ArtifactEditor:revalidate] Running validation after attempt ${state.attemptNumber}`);

    const allErrors: string[] = [];

    // ── Layer 1: Structural validation (validate-transitions) ──
    const validationInput = {
      stateTransitions: state.stateTransitions,
      stateSchema: state.stateSchema,
      transitionInstructions: state.transitionInstructions as Record<string, string>,
      playerPhaseInstructions: state.playerPhaseInstructions as Record<string, string>,
      gameSpecification: state.gameSpecification,
    } as SpecProcessingStateType;

    const structuralResult = validateTransitions(validationInput);
    const structuralErrors = structuralResult.issues
      .filter(issue => issue.severity === 'error')
      .map(issue => issue.message);
    allErrors.push(...structuralErrors);

    // ── Layer 2: Semantic validation (instruction validator cores) ──
    // Only run when instructions exist — if we're in transitions-only repair,
    // instructions haven't been extracted yet and semantic validators would
    // produce spurious errors.
    const hasInstructions =
      Object.keys(state.playerPhaseInstructions ?? {}).length > 0 ||
      Object.keys(state.transitionInstructions ?? {}).length > 0;

    if (hasInstructions) {
      const artifact = buildInstructionsArtifact(state);
      let transitions: TransitionsArtifact | null = null;
      try {
        transitions = typeof state.stateTransitions === 'string'
          ? JSON.parse(state.stateTransitions)
          : null;
      } catch { /* ignore parse errors — structural layer will catch */ }

      const stateSchema = state.stateSchema
        ? (typeof state.stateSchema === 'string' ? JSON.parse(state.stateSchema) : state.stateSchema)
        : undefined;

      // Run validator cores that don't need store access
      const coreResults = await Promise.all([
        validatePathStructureCore(artifact),
        validateActionRequiredSetCore(artifact),
        validateArtifactStructureCore(artifact, stateSchema),
        ...(transitions ? [
          validatePreconditionsCanPassCore(artifact, transitions),
          validateSelfBlockingTransitionsCore(artifact, transitions),
          validateInitialStatePreconditionsCore(artifact, transitions),
          validateGameCompletionCore(artifact, transitions),
          validatePhaseConnectivityCore(transitions, artifact),
        ] : []),
      ]);

      for (const errors of coreResults) {
        allErrors.push(...errors);
      }
    } else {
      // If original errors mention instructions (post-instructions repair), missing
      // instructions is itself a failure — the editor failed to produce them.
      const errorsReferenceInstructions = (state.errors ?? []).some(e =>
        /instruction|executor|schema.*validation/i.test(e)
      );
      if (errorsReferenceInstructions) {
        const msg = 'Instructions artifact is empty after repair — editor failed to regenerate instructions';
        console.error(`[ArtifactEditor:revalidate] ${msg}`);
        allErrors.push(msg);
      } else {
        console.log('[ArtifactEditor:revalidate] Skipping semantic validation — no instructions present (transitions-only repair)');
      }
    }

    // ── Layer 3: Mechanics validation (tsc) ──
    const hasMechanics = Object.keys(state.generatedMechanics ?? {}).length > 0;
    if (hasMechanics && state.stateInterfaces) {
      const tscResult = validateMechanics(state.stateInterfaces, state.generatedMechanics);
      if (!tscResult.valid) {
        const tscErrors = tscResult.errors.map(e =>
          `TS${e.code} in ${e.mechanicId} (line ${e.line}, col ${e.column}): ${e.message}`
        );
        allErrors.push(...tscErrors);
        console.log(`[ArtifactEditor:revalidate] ${tscErrors.length} tsc error(s) in mechanics`);
      } else {
        console.log(`[ArtifactEditor:revalidate] ✓ All mechanics pass tsc validation`);
      }
    }

    // ── Deduplicate errors (structural + semantic + tsc may overlap) ──
    const uniqueErrors = [...new Set(allErrors)];

    // ── Log results ──
    const warningMessages = structuralResult.issues
      .filter(issue => issue.severity === 'warning')
      .map(issue => issue.message);

    if (uniqueErrors.length > 0) {
      console.log(`[ArtifactEditor:revalidate] ${uniqueErrors.length} error(s) remaining:`);
      uniqueErrors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
    }
    if (warningMessages.length > 0) {
      console.log(`[ArtifactEditor:revalidate] ${warningMessages.length} warning(s):`);
      warningMessages.forEach((w, i) => console.log(`  ${i + 1}. ${w}`));
    }

    const succeeded = uniqueErrors.length === 0;

    if (succeeded) {
      console.log(`[ArtifactEditor:revalidate] ✓ All errors resolved after ${state.attemptNumber} attempt(s)`);
    }

    return {
      remainingErrors: uniqueErrors,
      editSucceeded: succeeded,
    };
  };
}
