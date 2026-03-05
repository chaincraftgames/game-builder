/**
 * Edit Transitions Node
 *
 * Applies transition patches from the change plan. For each change:
 *   - patch: extract fragment → LLM editor → deterministic replace
 *   - reextract: (future) invoke transitions extraction subgraph
 */

import type { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { TransitionSchema } from "#chaincraft/ai/simulate/schema.js";
import type { TransitionsArtifact } from "#chaincraft/ai/simulate/schema.js";
import type { ArtifactChange } from "../../types.js";
import {
  parseFragmentAddress,
  buildEditorSystemPrompt,
  type FragmentEditInput,
  type FragmentEditOutput,
  type FragmentResult,
  type ReplaceResult,
} from "../../node-shared.js";
import type { ArtifactEditorStateType } from "../../artifact-editor-state.js";
import { TRANSITIONS_EDITOR_SYSTEM_PROMPT } from "./prompts.js";

// ─── Fragment Ops ───

/**
 * Extract a single transition from the transitions artifact by transition ID.
 */
export function extractTransitionFragment(
  transitionsArtifact: TransitionsArtifact,
  transitionId: string,
): FragmentResult {
  const transition = transitionsArtifact.transitions.find(
    (t) => t.id === transitionId,
  );
  if (!transition) {
    return { fragment: "", found: false };
  }
  return { fragment: JSON.stringify(transition, null, 2), found: true };
}

/**
 * Replace a single transition in the transitions artifact by ID.
 * Returns the full artifact with the matching transition replaced.
 */
export function replaceTransitionFragment(
  transitionsArtifact: TransitionsArtifact,
  transitionId: string,
  updatedTransition: unknown,
): ReplaceResult {
  const index = transitionsArtifact.transitions.findIndex(
    (t) => t.id === transitionId,
  );
  if (index === -1) {
    return {
      artifact: JSON.stringify(transitionsArtifact, null, 2),
      replaced: false,
    };
  }

  const resolved =
    typeof updatedTransition === "string"
      ? JSON.parse(updatedTransition)
      : updatedTransition;

  const updatedTransitions = [...transitionsArtifact.transitions];
  updatedTransitions[index] = resolved;

  const updated = { ...transitionsArtifact, transitions: updatedTransitions };
  return { artifact: JSON.stringify(updated, null, 2), replaced: true };
}

// ─── LLM Editor ───

/**
 * Edit a single transition (preconditions, checked fields, etc.) via LLM.
 */
export async function editTransition(
  model: ModelWithOptions,
  input: FragmentEditInput,
): Promise<FragmentEditOutput> {
  try {
    const systemPrompt = buildEditorSystemPrompt(TRANSITIONS_EDITOR_SYSTEM_PROMPT, input);
    const result = await model.invokeWithSystemPrompt(
      systemPrompt,
      '',
      { agent: "transitions-editor" },
      TransitionSchema,
    );
    return { updatedFragment: result, success: true };
  } catch (err: any) {
    return {
      updatedFragment: null,
      success: false,
      error: err.message || String(err),
    };
  }
}

// ─── Node Factory ───

/**
 * Create the edit-transitions node function.
 * Filters changePlan for transitions changes and applies patches sequentially.
 */
export function createEditTransitionsNode(model: ModelWithOptions) {
  return async (state: ArtifactEditorStateType) => {
    const transitionsChanges =
      state.changePlan?.changes.filter((c) => c.artifact === "transitions") ??
      [];

    if (transitionsChanges.length === 0) {
      return {};
    }

    console.log(
      `[ArtifactEditor:edit-transitions] Applying ${transitionsChanges.length} change(s)`,
    );

    let currentArtifact =
      typeof state.stateTransitions === "string"
        ? JSON.parse(state.stateTransitions)
        : state.stateTransitions;

    const applied: ArtifactChange[] = [];
    const failures: string[] = [];

    for (const change of transitionsChanges) {
      if (change.operation === "reextract") {
        const msg = `transitions:reextract not implemented — cannot regenerate ${change.fragmentAddress || 'full artifact'}. Change: "${change.description}"`;
        console.warn(`[ArtifactEditor:edit-transitions] ${msg}`);
        failures.push(msg);
        continue;
      }

      // Patch operation
      if (!change.fragmentAddress) {
        const msg = `transitions:patch missing fragmentAddress for change: "${change.description}"`;
        console.error(`[ArtifactEditor:edit-transitions] ${msg}`);
        failures.push(msg);
        continue;
      }

      const address = parseFragmentAddress(
        "transitions",
        change.fragmentAddress,
      );
      console.log(`[ArtifactEditor:edit-transitions] Patching ${address.key}`);

      // Extract fragment
      const extractResult = extractTransitionFragment(
        currentArtifact,
        address.key,
      );
      if (!extractResult.found) {
        const availableIds = currentArtifact.transitions?.map((t: any) => t.id).join(', ') || '(none)';
        const msg = `transitions:patch fragment not found: "${address.key}" (parsed from "${change.fragmentAddress}"). Available transition IDs: [${availableIds}]`;
        console.error(`[ArtifactEditor:edit-transitions] ${msg}`);
        failures.push(msg);
        continue;
      }

      // Call LLM editor
      const editInput: FragmentEditInput = {
        fragment: extractResult.fragment,
        fragmentAddress: change.fragmentAddress,
        changeDescription: change.description,
        schemaFields: state.schemaFields,
        validationErrors: change.errorsAddressed,
      };

      const editResult = await editTransition(model, editInput);

      if (!editResult.success) {
        const msg = `transitions:patch LLM edit failed for "${address.key}": ${editResult.error}`;
        console.error(`[ArtifactEditor:edit-transitions] ${msg}`);
        failures.push(msg);
        continue;
      }

      // Deterministic replace
      const replaceResult = replaceTransitionFragment(
        currentArtifact,
        address.key,
        editResult.updatedFragment,
      );
      if (!replaceResult.replaced) {
        const msg = `transitions:patch replace failed for "${address.key}"`;
        console.error(`[ArtifactEditor:edit-transitions] ${msg}`);
        failures.push(msg);
        continue;
      }

      currentArtifact = JSON.parse(replaceResult.artifact);
      applied.push(change);
      console.log(`[ArtifactEditor:edit-transitions] ✓ ${address.key} patched`);
    }

    if (failures.length > 0) {
      console.warn(`[ArtifactEditor:edit-transitions] ${failures.length} change(s) failed: ${failures.join('; ')}`);
    }

    return {
      stateTransitions: JSON.stringify(currentArtifact, null, 2),
      changesApplied: [...state.changesApplied, ...applied],
      // Start fresh failures list for this pass (edit_instructions will accumulate on top)
      editFailures: [...failures],
    };
  };
}
