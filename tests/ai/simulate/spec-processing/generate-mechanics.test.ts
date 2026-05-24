/**
 * Generate Mechanics Node — Integration Test
 *
 * Tests the mechanic code generation node against wacky-weapons fixture data.
 * Uses REAL LLM calls. Requires CHAINCRAFT_SIM_API_KEY or ANTHROPIC_API_KEY.
 *
 * Constructs a mock planner output from the fixture's transitionInstructions,
 * invokes the generator, and prints the generated code for inspection.
 */

import { describe, it, expect } from '@jest/globals';
import { generateMechanicsNode } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/generate-mechanics/generator.js';
import { setupSpecInstructionsModel } from '#chaincraft/ai/model-config.js';
import type { InstructionsPlanningResponse } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-instructions/schema.js';
import type { SpecProcessingStateType } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/spec-processing-state.js';
import type { GraphConfigWithStore } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/node-shared.js';
import fixture from '../../../artifacts/wacky-weapons.json';

/**
 * Build a planner output from the fixture's transitionInstructions.
 * The real planner produces this via LLM; we construct it from the fixture
 * to test generation in isolation.
 */
function buildPlannerOutput(): InstructionsPlanningResponse {
  const transitions = Object.entries(fixture.transitionInstructions).map(([id, json]) => {
    const instr = JSON.parse(json);
    const hasMechanics = instr.mechanicsGuidance !== null && instr.mechanicsGuidance !== undefined;
    return {
      id,
      transitionName: instr.transitionName || id,
      mechanicsDescription: hasMechanics
        ? instr.mechanicsGuidance.computation || instr.mechanicsGuidance.rules?.[0] || null
        : null,
      requiresLLMReasoning: hasMechanics, // transitions with mechanicsGuidance need LLM reasoning
      usesRandomness: false,
      randomnessDescription: null,
      publicMessagePurpose: null,
      privateMessagesPurpose: null,
      imageContentSpec: null,
    };
  });

  return {
    naturalLanguageSummary: "Wacky weapons RPS game with weapon-to-RPS mapping and round resolution",
    playerPhases: [],
    transitions,
  };
}

/**
 * Create a mock store that serves the planner output and accepts puts.
 */
function createMockStore(plannerOutput: InstructionsPlanningResponse) {
  const stored: Record<string, any> = {};
  const planKey = 'instructions.plan.output';
  stored[planKey] = JSON.stringify(plannerOutput);

  return {
    get: async (namespace: string[], key: string) => {
      const lookupKey = namespace.join('.') + (key ? '.' + key : '');
      // Also try without key appended
      const val = stored[lookupKey] ?? stored[namespace.join('.')];
      if (val !== undefined) {
        return { value: val };
      }
      return undefined;
    },
    put: async (namespace: string[], key: string, value: any) => {
      const storeKey = namespace.join('.') + (key ? '.' + key : '');
      stored[storeKey] = value;
    },
    search: async () => [],
    delete: async () => {},
    batch: async () => [],
    list: async () => [],
  } as any;
}

describe('Generate Mechanics Node — Wacky Weapons', () => {

  it('should generate mechanic functions for transitions with mechanicsGuidance', async () => {
    console.log('\n========== GENERATE MECHANICS TEST: START ==========\n');

    // Setup
    const model = await setupSpecInstructionsModel();
    const node = generateMechanicsNode(model);
    const plannerOutput = buildPlannerOutput();
    const store = createMockStore(plannerOutput);

    // Log which transitions should be targeted
    const targets = plannerOutput.transitions.filter(t => t.requiresLLMReasoning && t.mechanicsDescription);
    console.log(`Generation targets (${targets.length}):`);
    targets.forEach(t => console.log(`  - ${t.id}: ${t.mechanicsDescription?.substring(0, 80)}...`));
    console.log();

    // Build minimal state from fixture
    const state = {
      gameSpecification: fixture.gameRules || '',
      stateSchema: fixture.stateSchema,
      stateTransitions: fixture.stateTransitions,
      transitionInstructions: fixture.transitionInstructions,
      playerPhaseInstructions: fixture.playerPhaseInstructions,
      specNarratives: {},
      dataSources: [],
      gameRules: fixture.gameRules || '',
      generatedMechanics: {},
      producedTokensConfiguration: '',
      exampleState: '',
      schemaValidationErrors: undefined,
      transitionsValidationErrors: undefined,
      instructionsValidationErrors: undefined,
      producedTokensValidationErrors: undefined,
    } as unknown as SpecProcessingStateType;

    const config: GraphConfigWithStore = {
      store,
      configurable: { thread_id: 'test-generate-mechanics-1' },
    };

    // Invoke
    const result = await node(state, config);

    // Output
    console.log('\n========== GENERATED MECHANICS ==========\n');

    const mechanics = result.generatedMechanics || {};
    const keys = Object.keys(mechanics);
    console.log(`Generated ${keys.length} mechanic function(s)\n`);

    for (const [transitionId, code] of Object.entries(mechanics)) {
      console.log(`\n--- ${transitionId} ---`);
      console.log(code);
      console.log(`--- end ${transitionId} (${(code as string).length} chars) ---\n`);
    }

    // Basic assertions
    expect(keys.length).toBe(targets.length);
    expect(keys).toContain('both_weapons_ready');
    expect(keys).toContain('resolve_round_outcome');

    // Each should be non-empty code
    for (const [id, code] of Object.entries(mechanics)) {
      expect(code).toBeTruthy();
      expect((code as string).length).toBeGreaterThan(50);
      console.log(`✓ ${id}: ${(code as string).length} chars`);
    }

    console.log('\n========== GENERATE MECHANICS TEST: DONE ==========');
  }, 120_000); // 2 min timeout for LLM calls
});
