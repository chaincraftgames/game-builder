/**
 * Artifact Editor Graph — Integration Test
 *
 * Exercises the full artifact editor graph end-to-end:
 *   START → coordinator → edit_schema → edit_transitions → edit_instructions → revalidate → END
 *
 * Uses the Superhero Showdown v2 fixture with two known cross-artifact issues:
 *   1. DEADLOCK: results_displayed precondition requires isGameWinner==true,
 *      but isGameWinner is only set in that transition's own instructions.
 *   2. UNKNOWN FIELD: both_characters_submitted precondition references
 *      allPlayersCompletedActions which doesn't exist in the schema.
 *
 * This makes REAL LLM calls (coordinator + editors). Requires CHAINCRAFT_SIM_API_KEY.
 */

import { describe, it, expect } from '@jest/globals';
import { createArtifactEditorGraph } from '#chaincraft/ai/simulate/graphs/artifact-editor-graph/index.js';
import { createArtifactEditorGraphConfig } from '#chaincraft/ai/graph-config.js';
import {
  SUPERHERO_SHOWDOWN_V2_SPEC,
  SUPERHERO_SHOWDOWN_V2_STATE_SCHEMA,
  SUPERHERO_SHOWDOWN_V2_SCHEMA_FIELDS,
  SUPERHERO_SHOWDOWN_V2_TRANSITIONS,
  SUPERHERO_SHOWDOWN_V2_PLAYER_PHASE_INSTRUCTIONS,
  SUPERHERO_SHOWDOWN_V2_TRANSITION_INSTRUCTIONS,
  SUPERHERO_SHOWDOWN_V2_VALIDATION_ERRORS,
} from './fixtures/superhero-showdown-cross-artifact.js';

describe('Artifact Editor Graph — Full Integration (Superhero Showdown v2)', () => {

  it('should resolve deadlock and unknown field errors in one pass', async () => {
    // ── Compile graph ──
    const graph = await createArtifactEditorGraph();

    // ── Graph input — full ArtifactEditorState ──
    const input = {
      gameSpecification: SUPERHERO_SHOWDOWN_V2_SPEC,
      errors: SUPERHERO_SHOWDOWN_V2_VALIDATION_ERRORS,
      schemaFields: SUPERHERO_SHOWDOWN_V2_SCHEMA_FIELDS,
      stateSchema: SUPERHERO_SHOWDOWN_V2_STATE_SCHEMA,
      stateTransitions: SUPERHERO_SHOWDOWN_V2_TRANSITIONS,
      playerPhaseInstructions: SUPERHERO_SHOWDOWN_V2_PLAYER_PHASE_INSTRUCTIONS,
      transitionInstructions: SUPERHERO_SHOWDOWN_V2_TRANSITION_INSTRUCTIONS,
    };

    const config = createArtifactEditorGraphConfig('test-artifact-editor-graph-1');

    console.log('\n========== ARTIFACT EDITOR GRAPH: START ==========');
    console.log(`Input errors (${input.errors.length}):`);
    input.errors.forEach((e, i) => console.log(`  ${i + 1}. ${e.substring(0, 120)}...`));

    // ── Invoke ──
    const result = await graph.invoke(input, config);

    console.log('\n========== ARTIFACT EDITOR GRAPH: RESULT ==========');
    console.log(`editSucceeded: ${result.editSucceeded}`);
    console.log(`attemptNumber: ${result.attemptNumber}`);
    console.log(`changesApplied: ${result.changesApplied?.length ?? 0}`);
    console.log(`remainingErrors: ${result.remainingErrors?.length ?? 0}`);
    if (result.remainingErrors?.length) {
      result.remainingErrors.forEach((e: string, i: number) =>
        console.log(`  remaining ${i + 1}: ${e.substring(0, 120)}...`)
      );
    }

    // ── Log change plan for inspection ──
    if (result.changePlan) {
      console.log('\n--- Change Plan ---');
      console.log(`diagnosis: ${result.changePlan.diagnosis}`);
      console.log(`confidence: ${result.changePlan.confidence}`);
      console.log(`changes (${result.changePlan.changes.length}):`);
      result.changePlan.changes.forEach((c: any, i: number) =>
        console.log(`  ${i + 1}. [${c.artifact}/${c.operation}] ${c.fragmentAddress}: ${c.description?.substring(0, 100)}...`)
      );
    }

    // ── Log mutated artifacts for inspection ──
    if (result.stateTransitions) {
      const transitions = JSON.parse(result.stateTransitions);
      const bcs = transitions.transitions?.find((t: any) => t.id === 'both_characters_submitted');
      console.log('\n--- Updated both_characters_submitted preconditions ---');
      console.log(JSON.stringify(bcs?.preconditions, null, 2));
    }

    if (result.transitionInstructions) {
      const ti = typeof result.transitionInstructions === 'string'
        ? JSON.parse(result.transitionInstructions)
        : result.transitionInstructions;
      console.log('\n--- Updated battle_generated instructions (stateDelta) ---');
      console.log(JSON.stringify(ti.battle_generated?.stateDelta, null, 2));
      console.log('\n--- Updated results_displayed instructions (stateDelta) ---');
      console.log(JSON.stringify(ti.results_displayed?.stateDelta, null, 2));
    }

    console.log('\n========== ARTIFACT EDITOR GRAPH: END ==========\n');

    // ═══════════════════════════════════════════════
    // ASSERTIONS
    // ═══════════════════════════════════════════════

    // 1. Graph should succeed (all errors resolved)
    expect(result.editSucceeded).toBe(true);
    expect(result.remainingErrors).toEqual([]);

    // 2. Should have produced a change plan
    expect(result.changePlan).toBeDefined();
    expect(result.changePlan.changes.length).toBeGreaterThanOrEqual(2);

    // 3. Should have applied changes
    expect(result.changesApplied.length).toBeGreaterThanOrEqual(1);

    // 4. Deadlock fix: isGameWinner should be set in battle_generated (or another
    //    transition before results_displayed), NOT only in results_displayed.
    const transitionInstructions = typeof result.transitionInstructions === 'string'
      ? JSON.parse(result.transitionInstructions)
      : result.transitionInstructions;

    // battle_generated should now set isGameWinner somewhere in its stateDelta
    const battleGenerated = transitionInstructions.battle_generated;
    expect(battleGenerated).toBeDefined();
    const battleDelta = JSON.stringify(battleGenerated.stateDelta);
    const battleSetsGameWinner = battleDelta.toLowerCase().includes('isgamewinner');
    console.log(`battle_generated sets isGameWinner: ${battleSetsGameWinner}`);

    // results_displayed should no longer set isGameWinner (moved to earlier transition)
    // OR the precondition should have been changed. Either fix is acceptable.
    const resultsDisplayed = transitionInstructions.results_displayed;
    expect(resultsDisplayed).toBeDefined();

    // At least one of: battle_generated sets isGameWinner, OR results_displayed
    // no longer requires isGameWinner precondition
    const resultsDelta = JSON.stringify(resultsDisplayed.stateDelta);
    const resultsDeltaSetsGameWinner = resultsDelta.toLowerCase().includes('isgamewinner');

    const transitions = JSON.parse(result.stateTransitions);
    const rdTransition = transitions.transitions?.find(
      (t: any) => t.id === 'results_displayed'
    );
    const winnerPrecondition = rdTransition?.preconditions?.find(
      (p: any) => p.id === 'winner_marked'
    );
    const winnerPreconditionRemoved = !winnerPrecondition;
    const winnerPreconditionChanged = winnerPrecondition && !JSON.stringify(winnerPrecondition.logic).includes('isGameWinner');

    // Deadlock resolved if ANY of these are true:
    // a) isGameWinner set in battle_generated (earlier transition)
    // b) winner_marked precondition removed from results_displayed
    // c) winner_marked precondition changed to not require isGameWinner
    const deadlockResolved = battleSetsGameWinner || winnerPreconditionRemoved || winnerPreconditionChanged;
    expect(deadlockResolved).toBe(true);

    // 5. Unknown field fix: both_characters_submitted should no longer reference
    //    allPlayersCompletedActions
    const bcsTransition = transitions.transitions?.find(
      (t: any) => t.id === 'both_characters_submitted'
    );
    expect(bcsTransition).toBeDefined();
    const bcsJson = JSON.stringify(bcsTransition.preconditions);
    expect(bcsJson).not.toContain('allPlayersCompletedActions');

    // The fix should use allPlayers operator or some other valid approach
    const noActionsRequired = bcsTransition.preconditions?.find(
      (p: any) => p.id === 'no_actions_required'
    );
    if (noActionsRequired) {
      // If precondition still exists, it should use a valid approach
      const logicStr = JSON.stringify(noActionsRequired.logic);
      const usesValidApproach = (
        logicStr.includes('allPlayers') ||
        logicStr.includes('actionRequired')
      );
      expect(usesValidApproach).toBe(true);
    }
    // If precondition was removed entirely, that's also acceptable

  }, 180_000); // 180s — coordinator + up to 3 editor LLM calls + revalidation
});
