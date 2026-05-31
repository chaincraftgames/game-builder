/**
 * Edit Mechanics Node Tests
 *
 * Unit tests (no LLM) for orchestration logic:
 *   - Cascade detection when upstream instructions were edited
 *   - Error handling for missing fragmentAddress / unknown mechanic ID
 *   - No-op when changePlan has no mechanics changes and no cascade
 *   - Deduplication of explicit + cascade targets
 *
 * Integration test (real LLM call):
 *   - Patch path: give node a changePlan with code bug errors,
 *     verify the mechanics subgraph produces fixed code
 *
 * Requires CHAINCRAFT_SIM_API_KEY for integration tests.
 */

import { describe, it, expect } from '@jest/globals';
import { createEditMechanicsNode } from '#chaincraft/ai/simulate/graphs/artifact-editor-graph/nodes/edit-mechanics/index.js';
import type { ArtifactEditorStateType } from '#chaincraft/ai/simulate/graphs/artifact-editor-graph/artifact-editor-state.js';
import type { ChangePlan } from '#chaincraft/ai/simulate/graphs/artifact-editor-graph/types.js';
import {
  CODE_BUG_MECHANIC_CODE,
  CODE_BUG_ERRORS,
  CODE_BUG_INPUT,
} from './fixtures/wacky-weapons-mechanics.js';

// ─── Helpers ───

/** Parse instruction JSON strings into objects (ArtifactEditorState format) */
function parseInstructionMap(json: string): Record<string, unknown> {
  const raw = JSON.parse(json);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    result[key] = value;
  }
  return result;
}

/** Build a minimal ArtifactEditorStateType-compatible object from fixture data */
function buildState(overrides: Partial<ArtifactEditorStateType>): ArtifactEditorStateType {
  return {
    gameSpecification: CODE_BUG_INPUT.gameSpecification,
    errors: [],
    schemaFields: CODE_BUG_INPUT.schemaFields,
    stateSchema: '',
    stateTransitions: CODE_BUG_INPUT.stateTransitions,
    transitionInstructions: parseInstructionMap(CODE_BUG_INPUT.transitionInstructions),
    playerPhaseInstructions: parseInstructionMap(CODE_BUG_INPUT.playerPhaseInstructions),
    generatedMechanics: CODE_BUG_MECHANIC_CODE,
    stateInterfaces: CODE_BUG_INPUT.stateInterfaces!,
    changePlan: null,
    attemptNumber: 1,
    changesApplied: [],
    editFailures: [],
    remainingErrors: [],
    editSucceeded: false,
    ...overrides,
  } as ArtifactEditorStateType;
}

// ═══════════════════════════════════════════════════════════════════════
// Unit Tests — Pure Logic (no LLM calls)
// ═══════════════════════════════════════════════════════════════════════

describe('Edit Mechanics Node — Unit Tests', () => {
  const editMechanics = createEditMechanicsNode();

  // ── No-op ──

  it('should return empty when no mechanics changes and no cascade', async () => {
    const state = buildState({
      changePlan: {
        diagnosis: 'Schema issue',
        confidence: 'high',
        changes: [
          { artifact: 'schema', operation: 'patch', fragmentAddress: 'game.foo', description: 'Add field', errorsAddressed: [] },
        ],
      },
    });

    const result = await editMechanics(state);
    expect(result).toEqual({});
  });

  // ── Error handling ──

  it('should record failure when patch has no fragmentAddress', async () => {
    const state = buildState({
      changePlan: {
        diagnosis: 'Code issue',
        confidence: 'high',
        changes: [
          { artifact: 'mechanics', operation: 'patch', description: 'Fix something', errorsAddressed: [] },
        ],
      },
    });

    const result = await editMechanics(state);
    expect(result.editFailures).toBeDefined();
    expect(result.editFailures!.length).toBe(1);
    expect(result.editFailures![0]).toContain('missing fragmentAddress');
  });

  it('should record failure when reextract has no fragmentAddress', async () => {
    const state = buildState({
      changePlan: {
        diagnosis: 'Code issue',
        confidence: 'high',
        changes: [
          { artifact: 'mechanics', operation: 'reextract', description: 'Regenerate something', errorsAddressed: [] },
        ],
      },
    });

    const result = await editMechanics(state);
    expect(result.editFailures).toBeDefined();
    expect(result.editFailures!.length).toBe(1);
    expect(result.editFailures![0]).toContain('missing fragmentAddress');
  });

  it('should record failure when mechanic ID not found in targets', async () => {
    const state = buildState({
      changePlan: {
        diagnosis: 'Code issue',
        confidence: 'high',
        changes: [
          { artifact: 'mechanics', operation: 'patch', fragmentAddress: 'nonexistent_mechanic', description: 'Fix it', errorsAddressed: [] },
        ],
      },
    });

    const result = await editMechanics(state);
    expect(result.editFailures).toBeDefined();
    expect(result.editFailures!.some(f => f.includes('target not found'))).toBe(true);
  });

  // ── Cascade detection ──

  it('should detect cascade when upstream transition instruction was edited', async () => {
    const state = buildState({
      changePlan: {
        diagnosis: 'Instructions needed fixing',
        confidence: 'high',
        changes: [
          // No explicit mechanics changes
          { artifact: 'instructions', operation: 'patch', fragmentAddress: 'transitionInstructions.resolve_round_outcome', description: 'Fix tie handling', errorsAddressed: [] },
        ],
      },
      // Simulate that edit_instructions already applied the instruction change
      changesApplied: [
        { artifact: 'instructions', operation: 'patch', fragmentAddress: 'transitionInstructions.resolve_round_outcome', description: 'Fix tie handling', errorsAddressed: [] },
      ],
    });

    // This will try to invoke createMechanicsGraph, which we can't run without LLM.
    // But we can verify the cascade is detected by checking it doesn't return empty.
    // We'll catch the subgraph error and check the failure message shows it tried.
    const result = await editMechanics(state);

    // It should have attempted to do something (not the no-op empty return)
    // Either it succeeded (generatedMechanics) or it failed trying (editFailures)
    const attempted = (result.generatedMechanics && Object.keys(result.generatedMechanics).length > 0)
      || (result.editFailures && result.editFailures.length > 0);
    expect(attempted).toBe(true);
  }, 120_000);

  it('should not cascade when instruction was edited but mechanic has no mechanicsGuidance', async () => {
    // weapon_setup has playerActions with mechanicsGuidance: null
    const state = buildState({
      changePlan: {
        diagnosis: 'Instructions fix',
        confidence: 'high',
        changes: [
          { artifact: 'instructions', operation: 'patch', fragmentAddress: 'playerPhaseInstructions.weapon_setup', description: 'Fix description', errorsAddressed: [] },
        ],
      },
      changesApplied: [
        { artifact: 'instructions', operation: 'patch', fragmentAddress: 'playerPhaseInstructions.weapon_setup', description: 'Fix description', errorsAddressed: [] },
      ],
    });

    const result = await editMechanics(state);
    expect(result).toEqual({});
  });
});


// ═══════════════════════════════════════════════════════════════════════
// Integration Test — Real LLM Call
// ═══════════════════════════════════════════════════════════════════════

describe('Edit Mechanics Node — Integration (Patch)', () => {
  it('should repair a code typo via patch operation', async () => {
    const changePlan: ChangePlan = {
      diagnosis: 'Field name typo: roundWon should be roundsWon',
      confidence: 'high',
      changes: [
        {
          artifact: 'mechanics',
          operation: 'patch',
          fragmentAddress: 'resolve_round_outcome',
          description: 'Fix field name typo: roundWon → roundsWon',
          errorsAddressed: CODE_BUG_ERRORS,
        },
      ],
    };

    const state = buildState({ changePlan });
    const editMechanics = createEditMechanicsNode();
    const result = await editMechanics(state);

    console.log('\n========== EDIT MECHANICS OUTPUT ==========');
    console.log('Generated mechanics keys:', Object.keys(result.generatedMechanics ?? {}));
    console.log('Changes applied:', result.changesApplied?.length ?? 0);
    console.log('Edit failures:', result.editFailures ?? []);
    if (result.generatedMechanics?.resolve_round_outcome) {
      console.log('\n--- resolve_round_outcome (repaired) ---');
      console.log(result.generatedMechanics.resolve_round_outcome);
    }
    console.log('===========================================\n');

    // Should have generated a repaired mechanic
    expect(result.generatedMechanics).toBeDefined();
    expect(result.generatedMechanics!.resolve_round_outcome).toBeDefined();

    // The repaired code should use roundsWon (not roundWon)
    const repairedCode = result.generatedMechanics!.resolve_round_outcome;
    expect(repairedCode).toContain('roundsWon');
    expect(repairedCode).not.toContain('roundWon');

    // Should track the applied change
    expect(result.changesApplied).toBeDefined();
    expect(result.changesApplied!.some(c => c.artifact === 'mechanics')).toBe(true);
  }, 120_000);
});
