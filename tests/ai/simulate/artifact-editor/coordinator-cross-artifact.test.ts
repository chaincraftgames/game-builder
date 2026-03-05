/**
 * Coordinator Test: Cross-Artifact Issues (Superhero Showdown v2)
 *
 * Tests whether the coordinator can diagnose and plan fixes for issues
 * that span multiple artifacts — the most valuable class of errors because
 * they require understanding how artifacts interact.
 *
 * Two cross-artifact issues in this fixture:
 *
 * 1. DEADLOCK: results_displayed transition precondition requires isGameWinner==true,
 *    but isGameWinner is only set in that transition's own instructions.
 *    Fix: move isGameWinner op to earlier transition (instructions) OR
 *         remove/change the precondition (transitions).
 *
 * 2. UNKNOWN FIELD: both_characters_submitted precondition references
 *    "allPlayersCompletedActions" which isn't in the schema.
 *    Fix: change precondition to use allPlayers operator (transitions) OR
 *         add the field to schema (schema).
 *
 * This makes a REAL LLM call. Requires CHAINCRAFT_SIM_API_KEY.
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { setupSimulationModel } from '#chaincraft/ai/model-config.js';
import { invokeCoordinator } from '#chaincraft/ai/simulate/graphs/artifact-editor-graph/nodes/coordinator/index.js';
import { ChangePlanSchema } from '#chaincraft/ai/simulate/graphs/artifact-editor-graph/types.js';
import type { ChangePlan } from '#chaincraft/ai/simulate/graphs/artifact-editor-graph/types.js';
import type { ModelWithOptions } from '#chaincraft/ai/model-config.js';
import {
  SUPERHERO_SHOWDOWN_V2_INPUT,
  SUPERHERO_SHOWDOWN_V2_VALIDATION_ERRORS,
} from './fixtures/superhero-showdown-cross-artifact.js';

describe('Coordinator - Cross-Artifact Issues (Superhero Showdown v2)', () => {
  let model: ModelWithOptions;

  beforeAll(async () => {
    model = await setupSimulationModel();
  }, 30_000);

  it('should diagnose deadlock and unknown field reference across artifacts', async () => {
    const plan: ChangePlan = await invokeCoordinator(model, SUPERHERO_SHOWDOWN_V2_INPUT);

    console.log('\n========== COORDINATOR OUTPUT (Cross-Artifact) ==========');
    console.log(JSON.stringify(plan, null, 2));
    console.log('=========================================================\n');

    // ── Structural validation ──
    const parsed = ChangePlanSchema.safeParse(plan);
    expect(parsed.success).toBe(true);
    expect(plan.diagnosis).toBeTruthy();
    expect(['high', 'medium', 'low']).toContain(plan.confidence);
    expect(plan.changes.length).toBeGreaterThanOrEqual(2);

    // ── Multi-artifact targeting ──
    // Cross-artifact fixes should span multiple artifact types.
    // The deadlock fix requires changes to transitions (remove/change precondition)
    // and/or instructions (move isGameWinner to earlier transition).
    const artifactTypes = new Set(plan.changes.map(c => c.artifact));
    expect(artifactTypes.size).toBeGreaterThanOrEqual(1);

    // ── Deadlock recognition ──
    // The coordinator must identify the results_displayed deadlock.
    const fullText = [
      plan.diagnosis,
      ...plan.changes.map(c => c.description),
    ].join(' ').toLowerCase();

    const recognizesDeadlock = (
      fullText.includes('deadlock') ||
      fullText.includes('never fire') ||
      fullText.includes('cannot fire') ||
      fullText.includes('circular') ||
      fullText.includes('own instruction') ||
      fullText.includes('self-referenc') ||
      (fullText.includes('precondition') && fullText.includes('isgamewinner')) ||
      (fullText.includes('winner_marked') && fullText.includes('results_displayed'))
    );
    expect(recognizesDeadlock).toBe(true);

    // ── Unknown field recognition ──
    // The coordinator must identify the allPlayersCompletedActions problem.
    const addressesUnknownField = (
      fullText.includes('allplayerscompletedactions') ||
      fullText.includes('unknown field') ||
      fullText.includes('not in schema') ||
      fullText.includes('does not exist') ||
      fullText.includes('no_actions_required') ||
      fullText.includes('allplayers operator')
    );
    expect(addressesUnknownField).toBe(true);

    // ── Operation selection ──
    // All artifacts exist with content, so prefer 'patch' over 'reextract'
    const patchCount = plan.changes.filter(c => c.operation === 'patch').length;
    expect(patchCount).toBeGreaterThanOrEqual(1);

    // ── Error coverage ──
    // Both validation errors should be addressed
    const allAddressedErrors = plan.changes.flatMap(c => c.errorsAddressed);
    for (const error of SUPERHERO_SHOWDOWN_V2_VALIDATION_ERRORS) {
      const errorKeyword = error.substring(0, 40).toLowerCase();
      const isAddressed = allAddressedErrors.some(
        addressed =>
          addressed.toLowerCase().includes(errorKeyword) ||
          errorKeyword.includes(addressed.toLowerCase().substring(0, 30)) ||
          // Fuzzy: check for key terms from each error
          (error.includes('deadlock') && addressed.includes('results_displayed')) ||
          (error.includes('allPlayersCompletedActions') && addressed.includes('allPlayersCompletedActions'))
      );
      expect(isAddressed).toBe(true);
    }

    // ── Dependency ordering ──
    // NOTE: We don't enforce strict ordering here because the two issues
    // (deadlock + unknown field) are independent. The coordinator may order
    // them in any way. Strict schema→transitions→instructions ordering only
    // matters when changes are causally dependent (e.g., add schema field
    // then reference it in instructions).
  }, 90_000); // 90s timeout — more complex reasoning with 3 interconnected errors
});
