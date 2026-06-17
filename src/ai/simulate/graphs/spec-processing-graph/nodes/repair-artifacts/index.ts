/**
 * Repair Artifacts Node
 *
 * Wrapper that invokes the artifact editor graph from within the
 * spec-processing pipeline. Handles state mapping between the two graph
 * state shapes and writes repaired artifacts back to SpecProcessingState.
 *
 * Three wrapper node factories:
 *   - createRepairTransitionsNode(): transitions-only repair (pre-instructions)
 *   - createRepairArtifactsNode(): full cross-artifact repair (post-instructions)
 *   - createRepairCoherenceNode(): best-effort repair for coherence check findings
 */

import { createArtifactEditorGraph } from '#chaincraft/ai/simulate/graphs/artifact-editor-graph/index.js';
import { deriveSchemaFieldsSummary, parseInstructionMap, serializeInstructionMap } from '#chaincraft/ai/simulate/graphs/artifact-editor-graph/utils.js';
import { createArtifactEditorGraphConfig } from '#chaincraft/ai/graph-config.js';
import type { GameCreationBus } from '#chaincraft/events/game-creation-status-bus.js';
import type { SpecProcessingStateType } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/spec-processing-state.js';
import { getFromStore, type GraphConfigWithStore } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/node-shared.js';
import { resolvePositionalPlayerTemplates } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-instructions/utils.js';
import type { InstructionsArtifact } from '#chaincraft/ai/simulate/schema.js';
import { generateStateInterfaces } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/generate-mechanics/generate-state-interfaces.js';
import type { GameStateField } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-schema/schema.js';
import type { ActionDefinition } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-action-definitions/schema.js';
import type { CoherenceIssue } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/coherence-check/schema.js';

// ─── Helpers (spec-processing-specific) ───

/**
 * Read instructions from the InMemoryStore and parse into separated maps.
 * The executor writes the raw InstructionsArtifact to store even when
 * validation fails (before the commit node skips state writes), so this
 * is the only reliable source when instructions haven't been committed.
 */
async function readInstructionsFromStore(
  config: GraphConfigWithStore | undefined,
): Promise<{ playerPhaseInstructions: Record<string, unknown>; transitionInstructions: Record<string, unknown> } | null> {
  const store = config?.store;
  const threadId = config?.configurable?.thread_id || 'default';
  if (!store) return null;

  try {
    const raw = await getFromStore(store, ['instructions', 'execution', 'output'], threadId);
    if (!raw) return null;

    let artifact: InstructionsArtifact = typeof raw === 'string' ? JSON.parse(raw) : raw;
    artifact = resolvePositionalPlayerTemplates(artifact);

    const playerPhaseInstructions: Record<string, unknown> = {};
    for (const [phaseName, phaseInstr] of Object.entries(artifact.playerPhases ?? {})) {
      playerPhaseInstructions[phaseName] = phaseInstr;
    }

    const transitionInstructions: Record<string, unknown> = {};
    for (const [transitionId, transInstr] of Object.entries(artifact.transitions ?? {})) {
      transitionInstructions[transitionId] = transInstr;
    }

    console.log(
      `[readInstructionsFromStore] Loaded from store: ${Object.keys(playerPhaseInstructions).length} player phases, ` +
      `${Object.keys(transitionInstructions).length} transitions`,
    );
    return { playerPhaseInstructions, transitionInstructions };
  } catch (error) {
    console.warn('[readInstructionsFromStore] Failed to read instructions from store:', error);
    return null;
  }
}

/**
 * Read transitions from the InMemoryStore.
 * Same pattern: executor writes to store before validation; commit skips
 * state writes when validation fails.
 */
async function readTransitionsFromStore(
  config: GraphConfigWithStore | undefined,
): Promise<string | null> {
  const store = config?.store;
  const threadId = config?.configurable?.thread_id || 'default';
  if (!store) return null;

  try {
    const raw = await getFromStore(store, ['transitions', 'execution', 'output'], threadId);
    if (!raw) return null;

    const transitions = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
    console.log(`[readTransitionsFromStore] Loaded transitions from store (${transitions.length} chars)`);
    return transitions;
  } catch (error) {
    console.warn('[readTransitionsFromStore] Failed to read transitions from store:', error);
    return null;
  }
}

// ─── Node Factories ───

/**
 * Create a repair node for transitions-only errors (pre-instructions extraction).
 *
 * Invoked when validate_transitions finds errors. Passes schema + transitions
 * to the artifact editor with empty instructions. If repair succeeds, clears
 * transitionsValidationErrors and updates stateTransitions + stateSchema.
 */
export function createRepairTransitionsNode() {
  return async (
    state: SpecProcessingStateType,
    config?: GraphConfigWithStore,
  ): Promise<Partial<SpecProcessingStateType>> => {
    const bus = config?.configurable?.statusBus as GameCreationBus | undefined;
    const errors = state.transitionsValidationErrors ?? [];
    if (errors.length === 0) {
      console.log('[RepairTransitions] No errors to repair, skipping');
      return {};
    }

    console.log(`[RepairTransitions] Invoking artifact editor for ${errors.length} transition error(s)`);
    bus?.emit({ type: 'repair:started', target: 'transitions' });

    const graph = await createArtifactEditorGraph();
    const threadId = config?.configurable?.thread_id || 'repair-transitions';
    const graphConfig = createArtifactEditorGraphConfig(`${threadId}-repair-transitions`);

    // Transitions may not be in state if validation failed before commit.
    // Fall back to reading from the store where the executor wrote them.
    let stateTransitions = state.stateTransitions;
    if (!stateTransitions) {
      const fromStore = await readTransitionsFromStore(config);
      if (fromStore) {
        stateTransitions = fromStore;
        console.log('[RepairTransitions] Using transitions from store (not yet committed to state)');
      }
    }

    const editorInput = {
      gameSpecification: state.gameSpecification,
      errors,
      schemaFields: deriveSchemaFieldsSummary(state.stateSchema),
      stateSchema: state.stateSchema,
      stateTransitions: stateTransitions ?? '',
      playerPhaseInstructions: {},  // empty — not extracted yet
      transitionInstructions: {},   // empty — not extracted yet
    };

    const result = await graph.invoke(editorInput, graphConfig);

    if (result.editSucceeded) {
      console.log('[RepairTransitions] ✓ Repair succeeded');
      bus?.emit({ type: 'repair:completed', target: 'transitions' });
      return {
        stateTransitions: result.stateTransitions,
        // Schema may have been modified (e.g., denormalization added fields)
        stateSchema: result.stateSchema || state.stateSchema,
        transitionsValidationErrors: null,  // clear errors
      };
    }

    console.warn(`[RepairTransitions] ✗ Repair failed, ${result.remainingErrors?.length ?? 0} error(s) remain`);
    bus?.emit({ type: 'repair:completed', target: 'transitions' });
    return {
      // Keep existing errors + add remaining as additional context
      transitionsValidationErrors: result.remainingErrors ?? errors,
    };
  };
}

/**
 * Create a repair node for cross-artifact errors (post-instructions extraction).
 *
 * Invoked when extract_instructions produces validation errors. Passes all
 * artifacts to the editor. If repair succeeds, clears instructionsValidationErrors
 * and updates all potentially mutated artifacts.
 */
export function createRepairArtifactsNode() {
  return async (
    state: SpecProcessingStateType,
    config?: GraphConfigWithStore,
  ): Promise<Partial<SpecProcessingStateType>> => {
    const bus = config?.configurable?.statusBus as GameCreationBus | undefined;
    const errors = state.instructionsValidationErrors ?? [];
    if (errors.length === 0) {
      console.log('[RepairArtifacts] No errors to repair, skipping');
      return {};
    }

    console.log(`[RepairArtifacts] Invoking artifact editor for ${errors.length} instruction/cross-artifact error(s)`);
    bus?.emit({ type: 'repair:started', target: 'instructions' });

    const graph = await createArtifactEditorGraph();
    const threadId = config?.configurable?.thread_id || 'repair-artifacts';
    const graphConfig = createArtifactEditorGraphConfig(`${threadId}-repair-artifacts`);

    // Instructions may not be in state if validation failed before commit.
    // Fall back to reading from the store where the executor wrote them.
    let playerPhaseInstructions: Record<string, unknown> = parseInstructionMap(state.playerPhaseInstructions ?? {});
    let transitionInstructions: Record<string, unknown> = parseInstructionMap(state.transitionInstructions ?? {});

    const hasStateInstructions = Object.keys(playerPhaseInstructions).length > 0 ||
      Object.keys(transitionInstructions).length > 0;

    if (!hasStateInstructions) {
      const fromStore = await readInstructionsFromStore(config);
      if (fromStore) {
        playerPhaseInstructions = fromStore.playerPhaseInstructions;
        transitionInstructions = fromStore.transitionInstructions;
        console.log('[RepairArtifacts] Using instructions from store (not yet committed to state)');
      } else {
        console.warn('[RepairArtifacts] No instructions in state or store — editor will work with empty instructions');
      }
    }

    const editorInput = {
      gameSpecification: state.gameSpecification,
      errors,
      schemaFields: deriveSchemaFieldsSummary(state.stateSchema),
      stateSchema: state.stateSchema,
      stateTransitions: state.stateTransitions,
      playerPhaseInstructions,
      transitionInstructions,
    };

    const result = await graph.invoke(editorInput, graphConfig);

    if (result.editSucceeded) {
      console.log('[RepairArtifacts] ✓ Repair succeeded');
      bus?.emit({ type: 'repair:completed', target: 'instructions' });
      return {
        stateTransitions: result.stateTransitions,
        stateSchema: result.stateSchema || state.stateSchema,
        playerPhaseInstructions: serializeInstructionMap(
          (result.playerPhaseInstructions ?? {}) as Record<string, unknown>,
        ),
        transitionInstructions: serializeInstructionMap(
          (result.transitionInstructions ?? {}) as Record<string, unknown>,
        ),
        instructionsValidationErrors: null,  // clear errors
      };
    }

    console.warn(`[RepairArtifacts] ✗ Repair failed, ${result.remainingErrors?.length ?? 0} error(s) remain`);
    bus?.emit({ type: 'repair:completed', target: 'instructions' });
    return {
      instructionsValidationErrors: result.remainingErrors ?? errors,
    };
  };
}

/**
 * Create a repair node for mechanics tsc validation failures.
 *
 * Invokes the full artifact editor graph with mechanics errors. The
 * coordinator diagnoses whether errors are code bugs (fix mechanics),
 * schema gaps (fix schema + regenerate), or instruction ambiguities
 * (fix instructions + regenerate).  This replaces the old simple-retry
 * approach that bypassed the coordinator.
 */
export function createRepairMechanicsNode() {
  return async (
    state: SpecProcessingStateType,
    config?: GraphConfigWithStore,
  ): Promise<Partial<SpecProcessingStateType>> => {
    const errors = state.mechanicsErrors ?? [];
    if (errors.length === 0) {
      console.log('[RepairMechanics] No errors to repair, skipping');
      return {};
    }

    const generatedMechanics = state.generatedMechanics ?? {};

    // Format tsc errors as human-readable strings for the coordinator
    const formattedErrors: string[] = [];
    for (const mechanicError of errors) {
      for (const e of mechanicError.errors) {
        formattedErrors.push(
          `TS${e.code} in ${e.mechanicId} (line ${e.line}, col ${e.column}): ${e.message}`,
        );
      }
    }

    console.log(
      `[RepairMechanics] Invoking artifact editor for ${formattedErrors.length} tsc error(s) ` +
        `across ${errors.length} mechanic(s)`,
    );

    // Generate stateInterfaces from current schema
    if (!state.stateSchema) {
      console.error('[RepairMechanics] No stateSchema available');
      return {};
    }

    const fields: GameStateField[] = JSON.parse(state.stateSchema);
    const actionDefs: ActionDefinition[] | undefined = state.actionDefinitions
      ? JSON.parse(state.actionDefinitions).actions
      : undefined;
    const stateInterfaces = generateStateInterfaces(fields, actionDefs);

    const graph = await createArtifactEditorGraph();
    const threadId = config?.configurable?.thread_id || 'repair-mechanics';
    const graphConfig = createArtifactEditorGraphConfig(`${threadId}-repair-mechanics`);

    const editorInput = {
      gameSpecification: state.gameSpecification,
      errors: formattedErrors,
      schemaFields: deriveSchemaFieldsSummary(state.stateSchema),
      stateSchema: state.stateSchema,
      stateTransitions: state.stateTransitions,
      playerPhaseInstructions: parseInstructionMap(state.playerPhaseInstructions ?? {}),
      transitionInstructions: parseInstructionMap(state.transitionInstructions ?? {}),
      generatedMechanics,
      stateInterfaces,
    };

    const result = await graph.invoke(editorInput, graphConfig);

    if (result.editSucceeded) {
      console.log('[RepairMechanics] ✓ Repair succeeded');
      return {
        generatedMechanics: result.generatedMechanics ?? generatedMechanics,
        mechanicsErrors: [],
        // Propagate any cross-artifact fixes the coordinator made
        stateSchema: result.stateSchema || state.stateSchema,
        stateTransitions: result.stateTransitions || state.stateTransitions,
        playerPhaseInstructions: serializeInstructionMap(
          (result.playerPhaseInstructions ?? {}) as Record<string, unknown>,
        ),
        transitionInstructions: serializeInstructionMap(
          (result.transitionInstructions ?? {}) as Record<string, unknown>,
        ),
      };
    }

    console.warn(
      `[RepairMechanics] ✗ Repair failed, ${result.remainingErrors?.length ?? 0} error(s) remain`,
    );

    // Merge any partially repaired mechanics back in
    const mergedMechanics = { ...generatedMechanics, ...(result.generatedMechanics ?? {}) };
    return {
      generatedMechanics: mergedMechanics,
      mechanicsErrors: errors, // Keep original errors — repair didn't fully resolve
    };
  };
}

/**
 * Create a repair node for coherence check findings.
 *
 * Runs best-effort after coherence_check. Filters findings to confirmed/probable,
 * formats them as diagnostic strings for the coordinator, then invokes the full
 * artifact editor graph. The coordinator diagnoses root causes (schema gaps, wrong
 * read sources, circular gates, etc.) and patches the appropriate artifacts.
 *
 * Best-effort: even if repair fails, the pipeline continues to extract_produced_tokens.
 * Mechanics and stateInterfaces are included so the coordinator can fix mechanic code
 * in-place without triggering a full regeneration cycle.
 */
export function createRepairCoherenceNode() {
  return async (
    state: SpecProcessingStateType,
    config?: GraphConfigWithStore,
  ): Promise<Partial<SpecProcessingStateType>> => {
    const bus = config?.configurable?.statusBus as GameCreationBus | undefined;
    const findings = state.coherenceFindings;

    // Filter to issues that warrant a repair attempt
    const actionableIssues: CoherenceIssue[] = (findings?.issues ?? []).filter(
      (i) => i.confidence === 'confirmed' || i.confidence === 'probable',
    );

    if (actionableIssues.length === 0) {
      console.log('[RepairCoherence] No actionable findings, skipping');
      return {};
    }

    // Format each finding as a diagnostic string the coordinator can reason about.
    // Include issueType and reasoning so the coordinator can map to a fix pattern.
    const errors: string[] = actionableIssues.map((i) =>
      `[${i.issueType}][${i.confidence}] affected: ${i.affectedIds.join(', ')} — ${i.description}. Reasoning: ${i.reasoning}`,
    );

    console.log(`[RepairCoherence] Invoking artifact editor for ${errors.length} coherence finding(s)`);
    bus?.emit({ type: 'repair:started', target: 'coherence' });

    const generatedMechanics = state.generatedMechanics ?? {};

    // Generate stateInterfaces so the coordinator can fix mechanic code in-place
    let stateInterfaces = '';
    if (state.stateSchema) {
      const fields: GameStateField[] = JSON.parse(state.stateSchema);
      const actionDefs: ActionDefinition[] | undefined = state.actionDefinitions
        ? JSON.parse(state.actionDefinitions).actions
        : undefined;
      stateInterfaces = generateStateInterfaces(fields, actionDefs);
    }

    const graph = await createArtifactEditorGraph();
    const threadId = config?.configurable?.thread_id || 'repair-coherence';
    const graphConfig = createArtifactEditorGraphConfig(`${threadId}-repair-coherence`);

    const editorInput = {
      gameSpecification: state.gameSpecification,
      errors,
      schemaFields: deriveSchemaFieldsSummary(state.stateSchema),
      stateSchema: state.stateSchema,
      stateTransitions: state.stateTransitions,
      playerPhaseInstructions: parseInstructionMap(state.playerPhaseInstructions ?? {}),
      transitionInstructions: parseInstructionMap(state.transitionInstructions ?? {}),
      generatedMechanics,
      stateInterfaces,
    };

    const result = await graph.invoke(editorInput, graphConfig);

    bus?.emit({ type: 'repair:completed', target: 'coherence' });

    if (result.editSucceeded) {
      console.log('[RepairCoherence] ✓ Repair succeeded');
      return {
        generatedMechanics: result.generatedMechanics ?? generatedMechanics,
        stateSchema: result.stateSchema || state.stateSchema,
        stateTransitions: result.stateTransitions || state.stateTransitions,
        playerPhaseInstructions: serializeInstructionMap(
          (result.playerPhaseInstructions ?? {}) as Record<string, unknown>,
        ),
        transitionInstructions: serializeInstructionMap(
          (result.transitionInstructions ?? {}) as Record<string, unknown>,
        ),
      };
    }

    console.warn(`[RepairCoherence] ✗ Repair failed (best-effort — pipeline continues)`);
    return {};
  };
}
