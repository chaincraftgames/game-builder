/**
 * Repair Artifacts Node
 *
 * Wrapper that invokes the artifact editor graph from within the
 * spec-processing pipeline. Handles state mapping between the two graph
 * state shapes and writes repaired artifacts back to SpecProcessingState.
 *
 * Two wrapper node factories:
 *   - createRepairTransitionsNode(): transitions-only repair (pre-instructions)
 *   - createRepairArtifactsNode(): full cross-artifact repair (post-instructions)
 */

import { createArtifactEditorGraph } from '#chaincraft/ai/simulate/graphs/artifact-editor-graph/index.js';
import { createArtifactEditorGraphConfig } from '#chaincraft/ai/graph-config.js';
import { extractSchemaFields } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/schema-utils.js';
import type { GameStateField } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-schema/schema.js';
import type { SpecProcessingStateType } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/spec-processing-state.js';
import { getFromStore, type GraphConfigWithStore } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/node-shared.js';
import { resolvePositionalPlayerTemplates } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-instructions/utils.js';
import type { InstructionsArtifact } from '#chaincraft/ai/simulate/schema.js';
import { generateStateInterfaces } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/generate-mechanics/generate-state-interfaces.js';

// ─── Helpers ───

/**
 * Derive a human-readable schemaFields summary from the stateSchema
 * (planner field array or JSON Schema) for the coordinator prompt.
 */
function deriveSchemaFieldsSummary(stateSchema: string): string {
  try {
    const parsed = JSON.parse(stateSchema);

    // GameStateField format: array of field definitions
    if (Array.isArray(parsed)) {
      return (parsed as GameStateField[]).map(f => {
        const prefix = f.path === 'game' ? 'game.' : 'players.*.';
        const name = f.name.startsWith('game.') || f.name.startsWith('players.')
          ? f.name
          : `${prefix}${f.name}`;
        const desc = f.purpose ? ` (${f.purpose})` : '';
        return `${name}: ${f.type}${desc}`;
      }).join('\n');
    }

    // JSON Schema format: use extractSchemaFields for paths
    const fields = extractSchemaFields(parsed);
    return [...fields].sort().join('\n');
  } catch {
    return stateSchema || '';
  }
}

/**
 * Parse instruction maps from SpecProcessingState format (Record<string, string>
 * where each value is a JSON string) into ArtifactEditorState format
 * (Record<string, unknown> where each value is a parsed object).
 */
function parseInstructionMap(map: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(map)) {
    try {
      result[key] = typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Serialize instruction maps back to SpecProcessingState format
 * (Record<string, string> where each value is a JSON string).
 */
function serializeInstructionMap(map: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) {
    result[key] = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  }
  return result;
}

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
    const errors = state.transitionsValidationErrors ?? [];
    if (errors.length === 0) {
      console.log('[RepairTransitions] No errors to repair, skipping');
      return {};
    }

    console.log(`[RepairTransitions] Invoking artifact editor for ${errors.length} transition error(s)`);

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
      return {
        stateTransitions: result.stateTransitions,
        // Schema may have been modified (e.g., denormalization added fields)
        stateSchema: result.stateSchema || state.stateSchema,
        transitionsValidationErrors: null,  // clear errors
      };
    }

    console.warn(`[RepairTransitions] ✗ Repair failed, ${result.remainingErrors?.length ?? 0} error(s) remain`);
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
    const errors = state.instructionsValidationErrors ?? [];
    if (errors.length === 0) {
      console.log('[RepairArtifacts] No errors to repair, skipping');
      return {};
    }

    console.log(`[RepairArtifacts] Invoking artifact editor for ${errors.length} instruction/cross-artifact error(s)`);

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
    const stateInterfaces = generateStateInterfaces(fields);

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
