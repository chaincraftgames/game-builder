/**
 * Instructions Validators — Store-Aware Wrappers
 *
 * Each exported function has the Validator signature:
 *   (state, store, threadId) => Promise<string[]>
 *
 * All real validation logic lives in validator-cores.ts.
 * These wrappers simply: fetch artifact from store → parse → delegate to core.
 */

import { BaseStore } from "@langchain/langgraph";
import { SpecProcessingStateType } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/spec-processing-state.js";
import { getFromStore } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/node-shared.js";
import {
  InstructionsArtifact,
  TransitionsArtifact,
} from "#chaincraft/ai/simulate/schema.js";
import {
  validatePlanCompletenessCore,
  validateJsonParseableCore,
  validatePathStructureCore,
  validatePreconditionsCanPassCore,
  validateActionRequiredSetCore,
  validateNarrativeMarkersCore,
  validateArtifactStructureCore,
  validateFieldCoverageCore,
  validateSelfBlockingTransitionsCore,
  validateInitialStatePreconditionsCore,
  validateGameCompletionCore,
  validatePhaseConnectivityCore,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-instructions/validator-cores.js";

// ─── Helpers ───

/** Fetch and parse the execution output (InstructionsArtifact) from store. */
async function getArtifactFromStore(
  store: BaseStore,
  threadId: string,
): Promise<InstructionsArtifact | null> {
  const executionOutput = await getFromStore(
    store,
    ["instructions", "execution", "output"],
    threadId,
  );
  if (!executionOutput) return null;

  return typeof executionOutput === 'string'
    ? JSON.parse(executionOutput)
    : executionOutput;
}

/** Parse transitions from state (JSON string or object). */
function parseTransitions(state: SpecProcessingStateType): TransitionsArtifact | null {
  try {
    return typeof state.stateTransitions === 'string'
      ? JSON.parse(state.stateTransitions)
      : state.stateTransitions;
  } catch {
    return null;
  }
}

// ─── Wrappers ───

/**
 * Validate planner output for completeness
 */
export async function validatePlanCompleteness(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string,
): Promise<string[]> {
  const plannerOutput = await getFromStore(
    store,
    ["instructions", "plan", "output"],
    threadId,
  );

  if (!plannerOutput || typeof plannerOutput !== 'string') {
    return ["Planner output is missing or invalid"];
  }

  return validatePlanCompletenessCore(plannerOutput);
}

/**
 * Validate executor output is parseable JSON
 */
export async function validateJsonParseable(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string,
): Promise<string[]> {
  const artifact = await getArtifactFromStore(store, threadId);
  if (!artifact) return ["Execution output is missing"];
  return validateJsonParseableCore(artifact);
}

/**
 * Validate path structure in all stateDelta operations
 */
export async function validatePathStructure(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string,
): Promise<string[]> {
  const artifact = await getArtifactFromStore(store, threadId);
  if (!artifact) return ["Execution output is missing"];
  return validatePathStructureCore(artifact);
}

/**
 * Validate precondition coverage - all fields used in preconditions must be written by some stateDelta op
 */
export async function validatePreconditionsCanPass(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string,
): Promise<string[]> {
  const artifact = await getArtifactFromStore(store, threadId);
  if (!artifact) return ["Execution output is missing"];

  const transitions = parseTransitions(state);
  if (!transitions) return [];

  return validatePreconditionsCanPassCore(artifact, transitions);
}

/**
 * Validate actionRequired is set in player actions
 */
export async function validateActionRequiredSet(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string,
): Promise<string[]> {
  const artifact = await getArtifactFromStore(store, threadId);
  if (!artifact) return ["Execution output is missing"];
  return validateActionRequiredSetCore(artifact);
}

/**
 * Validate narrative markers exist
 */
export async function validateNarrativeMarkers(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string,
): Promise<string[]> {
  const artifact = await getArtifactFromStore(store, threadId);
  if (!artifact) return ["Execution output is missing"];
  return validateNarrativeMarkersCore(artifact, state.specNarratives || {});
}

/**
 * Validate artifact structure and stateDelta operations
 */
export async function validateArtifactStructure(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string,
): Promise<string[]> {
  const artifact = await getArtifactFromStore(store, threadId);
  if (!artifact) return ["Execution output is missing"];

  const schema = typeof state.stateSchema === 'string'
    ? JSON.parse(state.stateSchema)
    : state.stateSchema;

  return validateArtifactStructureCore(artifact, schema);
}

/**
 * Validate field coverage (warnings only — returns [])
 */
export async function validateFieldCoverage(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string,
): Promise<string[]> {
  const artifact = await getArtifactFromStore(store, threadId);
  if (!artifact) return [];

  const transitions = parseTransitions(state);
  if (!transitions) return [];

  return validateFieldCoverageCore(artifact, transitions);
}

/**
 * Validate that no transition is self-blocking (deadlock detection)
 */
export async function validateSelfBlockingTransitions(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string,
): Promise<string[]> {
  const artifact = await getArtifactFromStore(store, threadId);
  if (!artifact) return [];

  const transitions = parseTransitions(state);
  if (!transitions) return [];

  return validateSelfBlockingTransitionsCore(artifact, transitions);
}

/**
 * Validate that initial state created by init transition doesn't create a deadlock
 */
export async function validateInitialStatePreconditions(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string,
): Promise<string[]> {
  console.debug('[extract_instructions][validation] Validating initial state preconditions');

  const artifact = await getArtifactFromStore(store, threadId);
  if (!artifact) return [];

  const transitions = parseTransitions(state);
  if (!transitions) return ['Cannot parse stateTransitions to validate initial state preconditions'];

  return validateInitialStatePreconditionsCore(artifact, transitions);
}

/**
 * Validate that game can properly end with winners declared
 */
export async function validateGameCompletion(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string,
): Promise<string[]> {
  const artifact = await getArtifactFromStore(store, threadId);
  if (!artifact) return ["Execution output is missing - cannot validate game completion"];

  const transitions = parseTransitions(state);
  if (!transitions) return ["Transitions artifact not found in state"];

  return validateGameCompletionCore(artifact, transitions);
}

/**
 * Validate phase connectivity and structural soundness
 */
export async function validatePhaseConnectivity(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string,
): Promise<string[]> {
  const transitions = parseTransitions(state);
  if (!transitions) return ["Transitions artifact not found in state"];

  // Optionally load artifact for richer validation
  const artifact = await getArtifactFromStore(store, threadId);
  return validatePhaseConnectivityCore(transitions, artifact ?? undefined);
}

