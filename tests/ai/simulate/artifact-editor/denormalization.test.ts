/**
 * Artifact Editor Graph — Denormalization Test (Pattern 2, Transitions-Only)
 *
 * Exercises the denormalization fix path:
 *   coordinator diagnoses non-det precondition → addField via schemaOps → rewrite precondition
 *
 * Uses the Wacky Weapons fixture with a single error:
 *   - player_wins_match has `logic: null, deterministic: false`
 *   - Instructions are empty (pipeline failed at transition validation)
 *
 * The coordinator must:
 *   1. Add a schema field (e.g. game.matchWinnerId) via schemaOps
 *   2. Rewrite the precondition to check the new field deterministically
 *   3. NOT attempt instruction edits (they're empty)
 *
 * This makes REAL LLM calls. Requires CHAINCRAFT_SIM_API_KEY.
 */

import { describe, it, expect } from '@jest/globals';
import { createArtifactEditorGraph } from '#chaincraft/ai/simulate/graphs/artifact-editor-graph/index.js';
import { createArtifactEditorGraphConfig } from '#chaincraft/ai/graph-config.js';
import {
  WACKY_WEAPONS_SPEC,
  WACKY_WEAPONS_STATE_SCHEMA,
  WACKY_WEAPONS_SCHEMA_FIELDS,
  WACKY_WEAPONS_TRANSITIONS,
  WACKY_WEAPONS_TRANSITION_INSTRUCTIONS,
  WACKY_WEAPONS_PLAYER_PHASE_INSTRUCTIONS,
  WACKY_WEAPONS_VALIDATION_ERRORS,
} from './fixtures/wacky-weapons-denormalization.js';

describe('Artifact Editor Graph — Denormalization (Wacky Weapons)', () => {

  it('should add schema field and rewrite non-det precondition', async () => {
    // ── Compile graph ──
    const graph = await createArtifactEditorGraph();

    // ── Graph input — mirrors createRepairTransitionsNode() shape ──
    const input = {
      gameSpecification: WACKY_WEAPONS_SPEC,
      errors: WACKY_WEAPONS_VALIDATION_ERRORS,
      schemaFields: WACKY_WEAPONS_SCHEMA_FIELDS,
      stateSchema: WACKY_WEAPONS_STATE_SCHEMA,
      stateTransitions: WACKY_WEAPONS_TRANSITIONS,
      playerPhaseInstructions: WACKY_WEAPONS_PLAYER_PHASE_INSTRUCTIONS,   // {} — empty
      transitionInstructions: WACKY_WEAPONS_TRANSITION_INSTRUCTIONS,       // {} — empty
    };

    const config = createArtifactEditorGraphConfig('test-denormalization-1');

    console.log('\n========== DENORMALIZATION TEST: START ==========');
    console.log(`Input errors (${input.errors.length}):`);
    input.errors.forEach((e, i) => console.log(`  ${i + 1}. ${e.substring(0, 140)}...`));
    console.log(`Instructions empty: TI=${Object.keys(input.transitionInstructions).length === 0}, PPI=${Object.keys(input.playerPhaseInstructions).length === 0}`);

    // ── Invoke ──
    const result = await graph.invoke(input, config);

    console.log('\n========== DENORMALIZATION TEST: RESULT ==========');
    console.log(`editSucceeded: ${result.editSucceeded}`);
    console.log(`attemptNumber: ${result.attemptNumber}`);
    console.log(`changesApplied: ${result.changesApplied?.length ?? 0}`);
    console.log(`remainingErrors: ${result.remainingErrors?.length ?? 0}`);
    if (result.remainingErrors?.length) {
      result.remainingErrors.forEach((e: string, i: number) =>
        console.log(`  remaining ${i + 1}: ${e.substring(0, 140)}...`)
      );
    }

    // ── Log change plan ──
    if (result.changePlan) {
      console.log('\n--- Change Plan ---');
      console.log(`diagnosis: ${result.changePlan.diagnosis}`);
      console.log(`confidence: ${result.changePlan.confidence}`);
      console.log(`changes (${result.changePlan.changes.length}):`);
      result.changePlan.changes.forEach((c: any, i: number) =>
        console.log(`  ${i + 1}. [${c.artifact}/${c.operation}] ${c.fragmentAddress ?? '(none)'}: ${c.description?.substring(0, 120)}`)
      );
      if (result.changePlan.schemaOps?.length) {
        console.log(`schemaOps (${result.changePlan.schemaOps.length}):`);
        result.changePlan.schemaOps.forEach((op: any, i: number) =>
          console.log(`  ${i + 1}. ${op.op} ${op.scope}.${op.field} (${op.type ?? 'n/a'})`)
        );
      }
    }

    // ── Log mutated schema ──
    if (result.stateSchema) {
      const schemaFields = JSON.parse(result.stateSchema) as Array<{ name: string; path: string; type: string }>;
      const gameFields = schemaFields.filter(f => f.path === 'game').map(f => f.name);
      console.log(`\n--- Schema game fields (${gameFields.length}): ${gameFields.join(', ')}`);
    }

    // ── Log mutated transitions ──
    if (result.stateTransitions) {
      const transitions = JSON.parse(result.stateTransitions);
      const pwm = transitions.transitions?.find((t: any) => t.id === 'player_wins_match');
      console.log('\n--- Updated player_wins_match preconditions ---');
      console.log(JSON.stringify(pwm?.preconditions, null, 2));
    }

    console.log('\n========== DENORMALIZATION TEST: END ==========\n');

    // ═══════════════════════════════════════════════
    // ASSERTIONS
    // ═══════════════════════════════════════════════

    // 1. Graph should succeed (all errors resolved)
    expect(result.editSucceeded).toBe(true);
    expect(result.remainingErrors).toEqual([]);

    // 2. Change plan should exist and include schemaOps
    expect(result.changePlan).toBeDefined();
    expect(result.changePlan.schemaOps).toBeDefined();
    expect(result.changePlan.schemaOps!.length).toBeGreaterThanOrEqual(1);

    // 3. schemaOps should include an addField for a winner-related field in game scope
    const addFieldOp = result.changePlan.schemaOps!.find(
      (op: any) => op.op === 'addField' && op.scope === 'game'
    );
    expect(addFieldOp).toBeDefined();
    // The field name should relate to the match winner (flexible on exact name)
    const fieldName = addFieldOp!.field.toLowerCase();
    const isWinnerRelated = fieldName.includes('winner') || fieldName.includes('match');
    console.log(`addField: game.${addFieldOp!.field} — winner-related: ${isWinnerRelated}`);
    expect(isWinnerRelated).toBe(true);

    // 4. Schema should now contain the new field (GameStateField[] format)
    const updatedSchema = JSON.parse(result.stateSchema) as Array<{ name: string; path: string }>;
    const newFieldExists = updatedSchema.some(
      f => f.name === addFieldOp!.field && f.path === 'game'
    );
    expect(newFieldExists).toBe(true);

    // 5. player_wins_match precondition should now be deterministic
    const updatedTransitions = JSON.parse(result.stateTransitions);
    const playerWinsMatch = updatedTransitions.transitions?.find(
      (t: any) => t.id === 'player_wins_match'
    );
    expect(playerWinsMatch).toBeDefined();
    expect(playerWinsMatch.preconditions.length).toBeGreaterThanOrEqual(1);

    // The rewritten precondition should have non-null logic and be deterministic
    const rewrittenPrecondition = playerWinsMatch.preconditions.find(
      (p: any) => p.id === 'match_winner_exists' || p.logic !== null
    );
    expect(rewrittenPrecondition).toBeDefined();
    expect(rewrittenPrecondition.logic).not.toBeNull();
    expect(rewrittenPrecondition.deterministic).toBe(true);

    // The precondition logic should reference the new schema field
    const logicStr = JSON.stringify(rewrittenPrecondition.logic);
    const referencesNewField = logicStr.includes(addFieldOp!.field);
    console.log(`Precondition logic references ${addFieldOp!.field}: ${referencesNewField}`);
    expect(referencesNewField).toBe(true);

    // 6. Instructions should still be empty (coordinator can't patch empty instructions)
    const ti = typeof result.transitionInstructions === 'string'
      ? JSON.parse(result.transitionInstructions)
      : result.transitionInstructions;
    expect(Object.keys(ti)).toHaveLength(0);

    const ppi = typeof result.playerPhaseInstructions === 'string'
      ? JSON.parse(result.playerPhaseInstructions)
      : result.playerPhaseInstructions;
    expect(Object.keys(ppi)).toHaveLength(0);

  }, 180_000); // 180s — coordinator + editor LLM calls + revalidation
});
