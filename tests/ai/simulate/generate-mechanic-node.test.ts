/**
 * generate-mechanic-node — Unit Tests
 *
 * Validates the generateAndValidateMechanic function in isolation
 * with a mocked LLM model. Exercises the full pipeline:
 * prompt formatting → LLM call → fence stripping → tsc validation.
 */

import { jest, describe, it, expect } from '@jest/globals';
import type { ModelWithOptions } from '#chaincraft/ai/model-config.js';
import { generateAndValidateMechanic } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/generate-mechanics/mechanic-generator.js';
import type { MechanicTarget } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/generate-mechanics/schema.js';
import {
  generateStateInterfaces,
  type GameStateField,
} from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/generate-mechanics/generate-state-interfaces.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_FIELDS: GameStateField[] = [
  { name: 'currentRound', type: 'number', path: 'game', purpose: 'Current round number' },
  { name: 'maxRounds', type: 'number', path: 'game', purpose: 'Total rounds' },
  { name: 'gameEnded', type: 'boolean', path: 'game', purpose: 'Whether game is over' },
  { name: 'roundOutcome', type: 'string', path: 'game', purpose: 'Round outcome narrative' },
  { name: 'roundsWon', type: 'number', path: 'player', purpose: 'Rounds won' },
  { name: 'selectedWeapon', type: 'string', path: 'player', purpose: 'Current weapon' },
  { name: 'ready', type: 'boolean', path: 'player', purpose: 'Player ready status' },
];

/** State interfaces generated from test fields — exercises generate-state-interfaces integration */
const STATE_INTERFACES = generateStateInterfaces(TEST_FIELDS);

const DEFAULT_TARGET: MechanicTarget = {
  id: 'resolve_round',
  type: 'transition',
  functionName: 'resolve_round',
  instructions: 'Compare selectedWeapon for each player. Increment roundsWon for the winner.',
};

// ---------------------------------------------------------------------------
// Mock model factory
// ---------------------------------------------------------------------------

function createMockModel(codeToReturn: string): ModelWithOptions {
  return {
    model: {} as any,
    modelName: 'mock-model',
    invokeWithSystemPrompt: jest.fn(async () => ({ content: codeToReturn })),
    invoke: jest.fn(),
    invokeWithMessages: jest.fn(),
    getCallbacks: () => [],
  } as unknown as ModelWithOptions;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateAndValidateMechanic', () => {
  it('returns valid result when LLM generates correct TypeScript', async () => {
    const code = `
export async function resolve_round(
  state: MechanicState,
  callLLM: CallLLM
): Promise<MechanicResult> {
  const round = state.game.currentRound + 1;
  return {
    game: { currentRound: round },
    publicMessage: "Round " + round + " complete!",
  };
}`;
    const model = createMockModel(code);
    const result = await generateAndValidateMechanic(model, DEFAULT_TARGET, STATE_INTERFACES);

    expect(result.valid).toBe(true);
    expect(result.mechanicId).toBe('resolve_round');
    expect(result.code).toContain('resolve_round');
    expect(result.errors).toBeUndefined();
  });

  it('returns errors when LLM generates code with type mismatch (TS2322)', async () => {
    const code = `
export async function resolve_round(
  state: MechanicState,
  callLLM: CallLLM
): Promise<MechanicResult> {
  return { game: { currentRound: "next" } };
}`;
    const model = createMockModel(code);
    const result = await generateAndValidateMechanic(model, DEFAULT_TARGET, STATE_INTERFACES);

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThanOrEqual(1);
    expect(result.errors!.some(e => e.code === 2322)).toBe(true);
  });

  it('returns errors when LLM accesses nonexistent field (TS2339)', async () => {
    const code = `
export async function resolve_round(
  state: MechanicState,
  callLLM: CallLLM
): Promise<MechanicResult> {
  const hp = state.game.health;
  return { game: { currentRound: 1 } };
}`;
    const model = createMockModel(code);
    const result = await generateAndValidateMechanic(model, DEFAULT_TARGET, STATE_INTERFACES);

    expect(result.valid).toBe(false);
    expect(result.errors!.some(e => e.code === 2339)).toBe(true);
    expect(result.errors![0].mechanicId).toBe('resolve_round');
  });

  it('strips markdown fences before validation', async () => {
    const validCode = `export async function resolve_round(
  state: MechanicState,
  callLLM: CallLLM
): Promise<MechanicResult> {
  return { game: { currentRound: state.game.currentRound + 1 } };
}`;
    const fenced = '```typescript\n' + validCode + '\n```';
    const model = createMockModel(fenced);
    const result = await generateAndValidateMechanic(model, DEFAULT_TARGET, STATE_INTERFACES);

    expect(result.valid).toBe(true);
    expect(result.code).not.toContain('```');
  });

  it('passes target context to the LLM prompt', async () => {
    const code = `export async function resolve_round(
  state: MechanicState,
  callLLM: CallLLM
): Promise<MechanicResult> {
  return { game: { currentRound: 1 } };
}`;
    const model = createMockModel(code);
    await generateAndValidateMechanic(
      model,
      {
        ...DEFAULT_TARGET,
        messageGuidance: 'Announce the round winner publicly.',
      },
      STATE_INTERFACES,
    );

    const calls = (model.invokeWithSystemPrompt as jest.Mock).mock.calls;
    expect(calls.length).toBe(1);
    const systemPrompt = calls[0][0] as string;

    // Prompt should contain target-specific context
    expect(systemPrompt).toContain('resolve_round');
    expect(systemPrompt).toContain('Compare selectedWeapon');
    expect(systemPrompt).toContain('Announce the round winner publicly');
    // Prompt should contain state interface types
    expect(systemPrompt).toContain('MechanicState');
    expect(systemPrompt).toContain('currentRound');
  });

  it('preserves code in result even when validation fails', async () => {
    const badCode = `
export async function resolve_round(
  state: MechanicState,
  callLLM: CallLLM
): Promise<MechanicResult> {
  return { game: { currentRound: "wrong" } };
}`;
    const model = createMockModel(badCode);
    const result = await generateAndValidateMechanic(model, DEFAULT_TARGET, STATE_INTERFACES);

    expect(result.valid).toBe(false);
    expect(result.code).toBeDefined();
    expect(result.code).toContain('resolve_round');
    expect(result.code).toContain('"wrong"');
  });
});
