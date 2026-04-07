/**
 * Coordinator Test: Mechanics Error Differentiation
 *
 * Tests whether the coordinator correctly differentiates between:
 *
 * A) Code bug — the instructions (plan) are correct but the generated mechanic
 *    has a type error (field name typo). Coordinator should target mechanics only.
 *
 * B) Instructions gap — the mechanicsGuidance computation is incomplete (omits
 *    tie handling), causing the generated code to implement wrong behavior.
 *    Coordinator should target instructions first (fix the plan), then mechanics.
 *
 * This makes REAL LLM calls. Requires CHAINCRAFT_SIM_API_KEY.
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { setupSimulationModel } from '#chaincraft/ai/model-config.js';
import { invokeCoordinator } from '#chaincraft/ai/simulate/graphs/artifact-editor-graph/nodes/coordinator/index.js';
import { ChangePlanSchema } from '#chaincraft/ai/simulate/graphs/artifact-editor-graph/types.js';
import type { ChangePlan } from '#chaincraft/ai/simulate/graphs/artifact-editor-graph/types.js';
import type { ModelWithOptions } from '#chaincraft/ai/model-config.js';
import {
  CODE_BUG_INPUT,
  CODE_BUG_ERRORS,
  INSTRUCTIONS_GAP_INPUT,
  INSTRUCTIONS_GAP_ERRORS,
  HASH_COLLISION_INPUT,
  HASH_COLLISION_ERRORS,
} from './fixtures/wacky-weapons-mechanics.js';

describe('Coordinator - Mechanics Error Differentiation', () => {
  let model: ModelWithOptions;

  beforeAll(async () => {
    model = await setupSimulationModel();
  }, 30_000);

  // ────────────────────────────────────────────────────────────
  // Scenario A: Code bug — typo in generated code, plan is correct
  // ────────────────────────────────────────────────────────────
  it('should target mechanics only for a code typo (TS2551)', async () => {
    const plan: ChangePlan = await invokeCoordinator(model, CODE_BUG_INPUT);

    console.log('\n========== COORDINATOR OUTPUT (Code Bug) ==========');
    console.log(JSON.stringify(plan, null, 2));
    console.log('====================================================\n');

    // ── Structural validation ──
    const parsed = ChangePlanSchema.safeParse(plan);
    expect(parsed.success).toBe(true);
    expect(plan.diagnosis).toBeTruthy();
    expect(plan.changes.length).toBeGreaterThanOrEqual(1);

    // ── Must target mechanics ──
    const mechanicsChanges = plan.changes.filter(c => c.artifact === 'mechanics');
    expect(mechanicsChanges.length).toBeGreaterThanOrEqual(1);

    // ── Should NOT target instructions (the plan is correct) ──
    const instructionsChanges = plan.changes.filter(c => c.artifact === 'instructions');
    expect(instructionsChanges).toHaveLength(0);

    // ── Should NOT target schema (roundsWon exists, it's just a typo) ──
    const schemaChanges = plan.changes.filter(c => c.artifact === 'schema');
    expect(schemaChanges).toHaveLength(0);

    // ── Should use patch, not reextract (surgical fix for a typo) ──
    const patchChanges = mechanicsChanges.filter(c => c.operation === 'patch');
    expect(patchChanges.length).toBeGreaterThanOrEqual(1);

    // ── Should reference the specific mechanic ──
    const fullText = [
      plan.diagnosis,
      ...plan.changes.map(c => c.description),
      ...plan.changes.map(c => c.fragmentAddress ?? ''),
    ].join(' ').toLowerCase();

    const referencesResolveRound = (
      fullText.includes('resolve_round_outcome') ||
      fullText.includes('resolve round outcome')
    );
    expect(referencesResolveRound).toBe(true);

    // ── Should recognize it's a typo ──
    const recognizesTypo = (
      fullText.includes('typo') ||
      fullText.includes('roundwon') ||
      fullText.includes('roundswon') ||
      fullText.includes('did you mean') ||
      fullText.includes('misspell') ||
      fullText.includes('rename') ||
      fullText.includes('incorrect field') ||
      fullText.includes('wrong field name') ||
      fullText.includes('property name')
    );
    expect(recognizesTypo).toBe(true);

    // ── Error coverage ──
    const allAddressed = plan.changes.flatMap(c => c.errorsAddressed);
    expect(allAddressed.length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  // ────────────────────────────────────────────────────────────
  // Scenario B: Instructions gap — plan is incomplete, code follows plan
  // ────────────────────────────────────────────────────────────
  it('should target instructions when the plan is incomplete (Pattern 13)', async () => {
    const plan: ChangePlan = await invokeCoordinator(model, INSTRUCTIONS_GAP_INPUT);

    console.log('\n========== COORDINATOR OUTPUT (Instructions Gap) ==========');
    console.log(JSON.stringify(plan, null, 2));
    console.log('============================================================\n');

    // ── Structural validation ──
    const parsed = ChangePlanSchema.safeParse(plan);
    expect(parsed.success).toBe(true);
    expect(plan.diagnosis).toBeTruthy();
    expect(plan.changes.length).toBeGreaterThanOrEqual(1);

    // ── Must target instructions (the plan needs fixing) ──
    const instructionsChanges = plan.changes.filter(c => c.artifact === 'instructions');
    expect(instructionsChanges.length).toBeGreaterThanOrEqual(1);

    // ── Should also target mechanics (regenerate from fixed plan) ──
    // The coordinator may target mechanics explicitly, or it may be implicit
    // (fixing instructions triggers regeneration). Accept either.
    const mechanicsChanges = plan.changes.filter(c => c.artifact === 'mechanics');

    // ── Should NOT target schema (schema is fine) ──
    const schemaChanges = plan.changes.filter(c => c.artifact === 'schema');
    expect(schemaChanges).toHaveLength(0);

    // ── Should recognize the tie handling gap ──
    const fullText = [
      plan.diagnosis,
      ...plan.changes.map(c => c.description),
    ].join(' ').toLowerCase();

    const recognizesTieGap = (
      fullText.includes('tie') ||
      fullText.includes('draw') ||
      fullText.includes('same type') ||
      fullText.includes('same rps') ||
      fullText.includes('no points') ||
      fullText.includes('computation') ||
      fullText.includes('mechanicsguidance') ||
      fullText.includes('incomplete')
    );
    expect(recognizesTieGap).toBe(true);

    // ── Dependency ordering: instructions before mechanics ──
    if (mechanicsChanges.length > 0 && instructionsChanges.length > 0) {
      const firstInstrIdx = plan.changes.findIndex(c => c.artifact === 'instructions');
      const firstMechIdx = plan.changes.findIndex(c => c.artifact === 'mechanics');
      expect(firstInstrIdx).toBeLessThan(firstMechIdx);
    }

    // ── Error coverage ──
    const allAddressed = plan.changes.flatMap(c => c.errorsAddressed);
    expect(allAddressed.length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  // ────────────────────────────────────────────────────────────
  // Scenario C: Ambiguous — hash collisions, vague distribution rule
  // The rules say "distribute reasonably" but the computation doesn't
  // operationalize it. Code follows the computation faithfully.
  // The coordinator should fix the plan, not just the code.
  // ────────────────────────────────────────────────────────────
  it('should target instructions for an ambiguous plan that under-specifies distribution (Pattern 13)', async () => {
    const plan: ChangePlan = await invokeCoordinator(model, HASH_COLLISION_INPUT);

    console.log('\n========== COORDINATOR OUTPUT (Hash Collision) ==========');
    console.log(JSON.stringify(plan, null, 2));
    console.log('==========================================================\n');

    // ── Structural validation ──
    const parsed = ChangePlanSchema.safeParse(plan);
    expect(parsed.success).toBe(true);
    expect(plan.diagnosis).toBeTruthy();
    expect(plan.changes.length).toBeGreaterThanOrEqual(1);

    // ── Must target instructions (the computation needs to be more specific) ──
    const instructionsChanges = plan.changes.filter(c => c.artifact === 'instructions');
    expect(instructionsChanges.length).toBeGreaterThanOrEqual(1);

    // ── Should NOT target schema (schema is fine) ──
    const schemaChanges = plan.changes.filter(c => c.artifact === 'schema');
    expect(schemaChanges).toHaveLength(0);

    // ── Should recognize the distribution / balance problem ──
    const fullText = [
      plan.diagnosis,
      ...plan.changes.map(c => c.description),
    ].join(' ').toLowerCase();

    const recognizesDistributionIssue = (
      fullText.includes('distribut') ||
      fullText.includes('balance') ||
      fullText.includes('unbalanced') ||
      fullText.includes('collision') ||
      fullText.includes('hash') ||
      fullText.includes('reasonabl') ||
      fullText.includes('computation') ||
      fullText.includes('constraint') ||
      fullText.includes('guarantee')
    );
    expect(recognizesDistributionIssue).toBe(true);

    // ── Should identify that the computation is under-specified ──
    // The coordinator should recognize the gap between the rule ("distribute
    // reasonably") and the computation (no distribution constraint), and
    // recommend tightening the computation.
    const recognizesSpecGap = (
      fullText.includes('computation') ||
      fullText.includes('mechanicsguidance') ||
      fullText.includes('instruction') ||
      fullText.includes('specification') ||
      fullText.includes('under-specif') ||
      fullText.includes('vague') ||
      fullText.includes('ambiguous') ||
      fullText.includes('explicit')
    );
    expect(recognizesSpecGap).toBe(true);

    // ── Dependency ordering: instructions before mechanics (if both present) ──
    const mechanicsChanges = plan.changes.filter(c => c.artifact === 'mechanics');
    if (mechanicsChanges.length > 0 && instructionsChanges.length > 0) {
      const firstInstrIdx = plan.changes.findIndex(c => c.artifact === 'instructions');
      const firstMechIdx = plan.changes.findIndex(c => c.artifact === 'mechanics');
      expect(firstInstrIdx).toBeLessThan(firstMechIdx);
    }

    // ── Error coverage ──
    const allAddressed = plan.changes.flatMap(c => c.errorsAddressed);
    expect(allAddressed.length).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
