/**
 * Edit Mechanics Node
 *
 * Applies mechanic changes from the change plan:
 *   - patch: build MechanicTarget with repairContext (prior code + tsc errors),
 *            invoke createMechanicsGraph()
 *   - reextract: build MechanicTarget from instructions (fresh generation),
 *                invoke createMechanicsGraph()
 *
 * Cascade behavior: If edit_instructions modified instructions that guide a
 * mechanic in this same pass, this node auto-regenerates that mechanic even
 * when the coordinator didn't explicitly plan a mechanics change.  This keeps
 * mechanics in sync with their upstream instructions.
 */

import {
  createMechanicsGraph,
  buildMechanicTargets,
} from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/generate-mechanics/index.js';
import type { MechanicTarget } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/generate-mechanics/schema.js';
import type { PlayerPhaseInstructions } from '#chaincraft/ai/simulate/schema.js';
import type { ArtifactChange } from '../../types.js';
import type { ArtifactEditorStateType } from '../../artifact-editor-state.js';

// ─── Helpers ───

/**
 * Serialize an instruction map from ArtifactEditorState format
 * (Record<string, unknown>) to the Record<string, string> format
 * expected by buildMechanicTargets.
 */
function serializeInstructionMap(map: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) {
    result[key] = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  }
  return result;
}

// ─── Cascade Detection ───

/**
 * Identify mechanic IDs whose upstream instructions were edited in this pass
 * but are NOT already targeted by an explicit mechanics change in the plan.
 *
 * Detection strategy:
 *   - Transition mechanics: ID matches the transitionInstruction key
 *   - Action mechanics: parse the edited playerPhaseInstruction to find
 *     actions whose mechanicsGuidance is non-null
 */
function findCascadeMechanicIds(
  state: ArtifactEditorStateType,
  allTargets: MechanicTarget[],
): Set<string> {
  const instructionChanges = (state.changesApplied ?? []).filter(
    c => c.artifact === 'instructions',
  );
  if (instructionChanges.length === 0) return new Set();

  // Collect instruction keys that were edited (from fragmentAddress)
  const editedKeys = new Set<string>();
  for (const change of instructionChanges) {
    if (!change.fragmentAddress) continue;
    // Addresses: "transitionInstructions.<id>", "playerPhaseInstructions.<name>",
    //            "transitions.<id>", "playerPhases.<name>", or bare key
    const parts = change.fragmentAddress.split('.');
    if (parts.length >= 2) {
      editedKeys.add(parts[1]);
    } else {
      editedKeys.add(parts[0]);
    }
  }

  // Mechanic IDs already covered by explicit changePlan entries
  const explicitMechanicIds = new Set(
    (state.changePlan?.changes ?? [])
      .filter(c => c.artifact === 'mechanics')
      .map(c => c.fragmentAddress)
      .filter(Boolean) as string[],
  );

  const cascadeIds = new Set<string>();

  for (const target of allTargets) {
    if (explicitMechanicIds.has(target.id)) continue;

    if (target.type === 'transition' && editedKeys.has(target.id)) {
      cascadeIds.add(target.id);
      continue;
    }

    // For action mechanics: check if the parent phase was edited
    if (target.type === 'action') {
      for (const key of editedKeys) {
        const phaseValue = state.playerPhaseInstructions[key];
        if (!phaseValue) continue;
        try {
          const phase: PlayerPhaseInstructions =
            typeof phaseValue === 'string' ? JSON.parse(phaseValue) : phaseValue;
          const match = phase.playerActions?.some(
            (a: { id: string; mechanicsGuidance?: unknown }) =>
              a.id === target.id && a.mechanicsGuidance,
          );
          if (match) {
            cascadeIds.add(target.id);
            break;
          }
        } catch {
          /* skip malformed phases */
        }
      }
    }
  }

  return cascadeIds;
}

// ─── Node Factory ───

/**
 * Create the edit-mechanics node function.
 *
 * Unlike edit-instructions/edit-transitions which use a per-fragment LLM
 * editor, this node delegates to the self-contained mechanics generation
 * subgraph (createMechanicsGraph) which handles prompt construction,
 * code generation, and in-memory tsc validation internally.
 */
export function createEditMechanicsNode() {
  return async (state: ArtifactEditorStateType) => {
    const mechanicsChanges =
      state.changePlan?.changes.filter(c => c.artifact === 'mechanics') ?? [];

    // Build all possible targets from current (potentially updated) instructions
    const transitionInstructionsJson = serializeInstructionMap(state.transitionInstructions);
    const playerPhaseInstructionsJson = serializeInstructionMap(state.playerPhaseInstructions);
    const allTargets = buildMechanicTargets(
      transitionInstructionsJson,
      playerPhaseInstructionsJson,
    );
    const targetsById = new Map(allTargets.map(t => [t.id, t]));

    // Detect cascade: instructions edited upstream → mechanics must regenerate
    const cascadeIds = findCascadeMechanicIds(state, allTargets);

    if (mechanicsChanges.length === 0 && cascadeIds.size === 0) {
      return {};
    }

    console.log(
      `[ArtifactEditor:edit-mechanics] ${mechanicsChanges.length} explicit change(s), ` +
        `${cascadeIds.size} cascade regeneration(s)`,
    );

    const targets: MechanicTarget[] = [];
    const applied: ArtifactChange[] = [];
    const failures: string[] = [];

    // ── 1. Process explicit changePlan entries ──

    for (const change of mechanicsChanges) {
      const mechanicId = change.fragmentAddress;

      if (!mechanicId) {
        const msg =
          `mechanics:${change.operation} missing fragmentAddress for change: "${change.description}"`;
        console.error(`[ArtifactEditor:edit-mechanics] ${msg}`);
        failures.push(msg);
        continue;
      }

      const baseTarget = targetsById.get(mechanicId);
      if (!baseTarget) {
        const available = allTargets.map(t => t.id).join(', ') || '(none)';
        const msg =
          `mechanics: target not found for "${mechanicId}". Available: [${available}]`;
        console.error(`[ArtifactEditor:edit-mechanics] ${msg}`);
        failures.push(msg);
        continue;
      }

      if (change.operation === 'patch') {
        const existingCode = state.generatedMechanics[mechanicId];
        if (!existingCode) {
          console.warn(
            `[ArtifactEditor:edit-mechanics] No existing code for "${mechanicId}" — treating as reextract`,
          );
          targets.push(baseTarget);
        } else {
          targets.push({
            ...baseTarget,
            repairContext: {
              previousCode: existingCode,
              tscErrors: change.errorsAddressed ?? [],
            },
          });
        }
      } else {
        // reextract — fresh generation from (updated) instructions
        targets.push(baseTarget);
      }

      applied.push(change);
    }

    // ── 2. Cascade: regenerate mechanics whose upstream instructions changed ──

    for (const mechanicId of cascadeIds) {
      const baseTarget = targetsById.get(mechanicId);
      if (!baseTarget) continue;
      console.log(`[ArtifactEditor:edit-mechanics] Cascade regeneration: ${mechanicId}`);
      targets.push(baseTarget); // Fresh generation — no repairContext
    }

    // Deduplicate by ID (explicit entries take priority over cascade)
    const seen = new Set<string>();
    const deduped: MechanicTarget[] = [];
    for (const target of targets) {
      if (!seen.has(target.id)) {
        seen.add(target.id);
        deduped.push(target);
      }
    }

    if (deduped.length === 0) {
      if (failures.length > 0) {
        return { editFailures: [...(state.editFailures || []), ...failures] };
      }
      return {};
    }

    // ── 3. Invoke mechanics subgraph ──

    console.log(
      `[ArtifactEditor:edit-mechanics] Invoking mechanics subgraph for ` +
        `${deduped.length} target(s): ${deduped.map(t => t.id).join(', ')}`,
    );

    try {
      const graph = await createMechanicsGraph();
      const result = await graph.invoke({
        targets: deduped,
        stateInterfaces: state.stateInterfaces,
        existingCode: state.generatedMechanics,
      });

      const newMechanics: Record<string, string> = result.generatedMechanics ?? {};
      const newErrors = result.mechanicsErrors ?? [];

      console.log(
        `[ArtifactEditor:edit-mechanics] ✓ Generated ${Object.keys(newMechanics).length} ` +
          `mechanic(s), ${newErrors.length} error(s)`,
      );

      if (newErrors.length > 0) {
        for (const err of newErrors) {
          const msgs = err.errors.map((e: { message: string }) => e.message).join('; ');
          failures.push(`mechanics:tsc errors in ${err.mechanicId}: ${msgs}`);
        }
      }

      return {
        generatedMechanics: newMechanics,
        changesApplied: [...state.changesApplied, ...applied],
        editFailures: [...(state.editFailures || []), ...failures],
      };
    } catch (err: any) {
      const msg = `mechanics subgraph failed: ${err.message || String(err)}`;
      console.error(`[ArtifactEditor:edit-mechanics] ${msg}`);
      failures.push(msg);
      return {
        changesApplied: [...state.changesApplied, ...applied],
        editFailures: [...(state.editFailures || []), ...failures],
      };
    }
  };
}
