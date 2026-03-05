/**
 * Edit Instructions Node
 *
 * Applies instruction patches from the change plan. For each change:
 *   - patch: parse address → extract fragment → LLM editor → deterministic replace
 *   - reextract: (future) invoke instructions extraction subgraph
 *
 * Instructions have two sub-types routed by fragment address:
 *   - transitionInstructions.<id> → editTransitionInstruction (AutomaticTransitionInstructionSchema)
 *   - playerPhaseInstructions.<name> → editPlayerPhaseInstruction (PlayerPhaseInstructionsSchema)
 */

import type { ModelWithOptions } from '#chaincraft/ai/model-config.js';
import {
  AutomaticTransitionInstructionSchema,
  PlayerPhaseInstructionsSchema,
} from '#chaincraft/ai/simulate/schema.js';
import type {
  AutomaticTransitionInstruction,
  PlayerPhaseInstructions,
} from '#chaincraft/ai/simulate/schema.js';
import type { ArtifactChange } from '../../types.js';
import {
  parseFragmentAddress,
  buildEditorSystemPrompt,
  type FragmentEditInput,
  type FragmentEditOutput,
  type FragmentResult,
  type ReplaceResult,
} from '../../node-shared.js';
import type { ArtifactEditorStateType } from '../../artifact-editor-state.js';
import { INSTRUCTIONS_EDITOR_SYSTEM_PROMPT } from './prompts.js';

// ─── Fragment Ops ───

/**
 * Extract a single instruction fragment by key from a keyed map.
 */
export function extractInstructionFragment(
  instructionsMap: Record<string, unknown>,
  key: string,
): FragmentResult {
  const fragment = instructionsMap[key];
  if (fragment === undefined) {
    return { fragment: '', found: false };
  }
  return { fragment: JSON.stringify(fragment, null, 2), found: true };
}

/**
 * Replace a single instruction fragment by key.
 * Returns a new map with the fragment replaced.
 */
export function replaceInstructionFragment(
  instructionsMap: Record<string, unknown>,
  key: string,
  updatedFragment: unknown,
): ReplaceResult {
  if (!(key in instructionsMap)) {
    return { artifact: JSON.stringify(instructionsMap, null, 2), replaced: false };
  }

  const resolved = typeof updatedFragment === 'string'
    ? JSON.parse(updatedFragment)
    : updatedFragment;

  const updated = { ...instructionsMap, [key]: resolved };
  return { artifact: JSON.stringify(updated, null, 2), replaced: true };
}

// ─── LLM Editors ───

/**
 * Edit a single automatic transition instruction via LLM.
 */
export async function editTransitionInstruction(
  model: ModelWithOptions,
  input: FragmentEditInput,
): Promise<FragmentEditOutput> {
  try {
    const systemPrompt = buildEditorSystemPrompt(INSTRUCTIONS_EDITOR_SYSTEM_PROMPT, input);
    const result = await model.invokeWithSystemPrompt(
      systemPrompt,
      '',
      { agent: 'instructions-editor' },
      AutomaticTransitionInstructionSchema,
    );
    return { updatedFragment: result, success: true };
  } catch (err: any) {
    return { updatedFragment: null, success: false, error: err.message || String(err) };
  }
}

/**
 * Edit a single player phase instruction via LLM.
 */
export async function editPlayerPhaseInstruction(
  model: ModelWithOptions,
  input: FragmentEditInput,
): Promise<FragmentEditOutput> {
  try {
    const systemPrompt = buildEditorSystemPrompt(INSTRUCTIONS_EDITOR_SYSTEM_PROMPT, input);
    const result = await model.invokeWithSystemPrompt(
      systemPrompt,
      '',
      { agent: 'instructions-editor' },
      PlayerPhaseInstructionsSchema,
    );
    return { updatedFragment: result, success: true };
  } catch (err: any) {
    return { updatedFragment: null, success: false, error: err.message || String(err) };
  }
}

// ─── Node Factory ───

/**
 * Create the edit-instructions node function.
 * Filters changePlan for instructions changes and applies patches sequentially.
 */
export function createEditInstructionsNode(model: ModelWithOptions) {
  return async (state: ArtifactEditorStateType) => {
    const instructionsChanges = state.changePlan?.changes.filter(c => c.artifact === 'instructions') ?? [];

    if (instructionsChanges.length === 0) {
      return {};
    }

    console.log(`[ArtifactEditor:edit-instructions] Applying ${instructionsChanges.length} change(s)`);

    let currentTransitionInstructions = { ...state.transitionInstructions };
    let currentPlayerPhaseInstructions = { ...state.playerPhaseInstructions };

    const applied: ArtifactChange[] = [];
    const failures: string[] = [];

    for (const change of instructionsChanges) {
      if (change.operation === 'reextract') {
        // TODO: Invoke instructions extraction subgraph
        const msg = `instructions:reextract not implemented — cannot regenerate ${change.fragmentAddress || 'full artifact'}. Change: "${change.description}"`;
        console.warn(`[ArtifactEditor:edit-instructions] ${msg}`);
        failures.push(msg);
        continue;
      }

      // Patch operation
      if (!change.fragmentAddress) {
        const msg = `instructions:patch missing fragmentAddress for change: "${change.description}"`;
        console.error(`[ArtifactEditor:edit-instructions] ${msg}`);
        failures.push(msg);
        continue;
      }

      const address = parseFragmentAddress('instructions', change.fragmentAddress);
      console.log(`[ArtifactEditor:edit-instructions] Patching ${address.type}:${address.key}`);

      // Select the right map and editor based on address type
      const isTransitionInstruction = address.type === 'transitionInstruction';
      const instructionsMap = isTransitionInstruction
        ? currentTransitionInstructions
        : currentPlayerPhaseInstructions;

      // Extract fragment
      const extractResult = extractInstructionFragment(instructionsMap, address.key);
      if (!extractResult.found) {
        const mapType = isTransitionInstruction ? 'transitionInstructions' : 'playerPhaseInstructions';
        const availableKeys = Object.keys(instructionsMap).join(', ') || '(empty)';
        const msg = `instructions:patch fragment not found: ${address.type}:${address.key} (parsed from "${change.fragmentAddress}"). Available ${mapType} keys: [${availableKeys}]`;
        console.error(`[ArtifactEditor:edit-instructions] ${msg}`);
        failures.push(msg);
        continue;
      }

      // Call LLM editor (route to correct editor by address type)
      const editInput: FragmentEditInput = {
        fragment: extractResult.fragment,
        fragmentAddress: change.fragmentAddress,
        changeDescription: change.description,
        schemaFields: state.schemaFields,
        validationErrors: change.errorsAddressed,
      };

      const editResult = isTransitionInstruction
        ? await editTransitionInstruction(model, editInput)
        : await editPlayerPhaseInstruction(model, editInput);

      if (!editResult.success) {
        const msg = `instructions:patch LLM edit failed for ${address.type}:${address.key}: ${editResult.error}`;
        console.error(`[ArtifactEditor:edit-instructions] ${msg}`);
        failures.push(msg);
        continue;
      }

      // Deterministic replace
      const replaceResult = replaceInstructionFragment(instructionsMap, address.key, editResult.updatedFragment);
      if (!replaceResult.replaced) {
        const msg = `instructions:patch replace failed for ${address.type}:${address.key}`;
        console.error(`[ArtifactEditor:edit-instructions] ${msg}`);
        failures.push(msg);
        continue;
      }

      // Update the right map
      const updatedMap = JSON.parse(replaceResult.artifact);
      if (isTransitionInstruction) {
        currentTransitionInstructions = updatedMap;
      } else {
        currentPlayerPhaseInstructions = updatedMap;
      }

      applied.push(change);
      console.log(`[ArtifactEditor:edit-instructions] ✓ ${address.type}:${address.key} patched`);
    }

    if (failures.length > 0) {
      console.warn(`[ArtifactEditor:edit-instructions] ${failures.length} change(s) failed: ${failures.join('; ')}`);
    }

    return {
      transitionInstructions: currentTransitionInstructions,
      playerPhaseInstructions: currentPlayerPhaseInstructions,
      changesApplied: [...state.changesApplied, ...applied],
      // Accumulate failures from earlier editors (edit_transitions) + this node
      editFailures: [...(state.editFailures || []), ...failures],
    };
  };
}
