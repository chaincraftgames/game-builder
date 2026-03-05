/**
 * State for Artifact Editor Graph
 *
 * The artifact editor receives validation errors and current artifacts,
 * produces a ChangePlan via the coordinator, then routes through
 * per-artifact-type editor nodes to apply patches or re-extractions.
 *
 * Follows the same Annotation.Root pattern as SpecProcessingState.
 */

import { Annotation } from '@langchain/langgraph';
import type { ChangePlan, ArtifactChange } from './types.js';

export type ArtifactEditorStateType = typeof ArtifactEditorState.State;

export const ArtifactEditorState = Annotation.Root({
  // ─── Inputs (set by caller, read-only within the graph) ───

  /** Full game specification text */
  gameSpecification: Annotation<string>({
    reducer: (_, y) => y,
  }),

  /** Validation errors that triggered editing */
  errors: Annotation<string[]>({
    reducer: (_, y) => y,
    default: () => [],
  }),

  /** Schema fields summary string (e.g., "game.currentPhase: string, ...") */
  schemaFields: Annotation<string>({
    reducer: (_, y) => y,
    default: () => '',
  }),

  // ─── Artifact State (current versions, mutated by editor nodes) ───

  /** State schema JSON string */
  stateSchema: Annotation<string>({
    reducer: (_, y) => y,
    default: () => '',
  }),

  /** State transitions JSON string (full artifact with phases + transitions array) */
  stateTransitions: Annotation<string>({
    reducer: (_, y) => y,
    default: () => '',
  }),

  /** Player phase instructions keyed by phase name */
  playerPhaseInstructions: Annotation<Record<string, unknown>>({
    reducer: (_, y) => y,
    default: () => ({}),
  }),

  /** Transition instructions keyed by transition ID */
  transitionInstructions: Annotation<Record<string, unknown>>({
    reducer: (_, y) => y,
    default: () => ({}),
  }),

  // ─── Coordinator Output ───

  /** The change plan produced by the coordinator */
  changePlan: Annotation<ChangePlan | null>({
    reducer: (_, y) => y,
    default: () => null,
  }),

  // ─── Tracking ───

  /** Current attempt number (incremented each coordinator pass) */
  attemptNumber: Annotation<number>({
    reducer: (_, y) => y,
    default: () => 0,
  }),

  /** Changes that were successfully applied in the current pass */
  changesApplied: Annotation<ArtifactChange[]>({
    reducer: (_, y) => y,
    default: () => [],
  }),

  /** Edit failures from the previous coordinator→editor pass (skip reasons, unimplemented ops, etc.) */
  editFailures: Annotation<string[]>({
    reducer: (_, y) => y,
    default: () => [],
  }),

  /** Errors remaining after revalidation (drives retry logic) */
  remainingErrors: Annotation<string[]>({
    reducer: (_, y) => y,
    default: () => [],
  }),

  /** Whether the editing cycle succeeded (all errors resolved) */
  editSucceeded: Annotation<boolean>({
    reducer: (_, y) => y,
    default: () => false,
  }),
});
