/**
 * tsc-validator — Unit Tests
 *
 * Validates in-memory TypeScript compilation of mechanic code against
 * hand-crafted state interfaces. No dependency on Task A or B.
 */

import { describe, it, expect } from '@jest/globals';
import { validateMechanics } from '#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/generate-mechanics/tsc-validator.js';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

/** Minimal state interfaces used across all tests */
const STATE_INTERFACES = `
export interface GameState {
  currentRound: number;
  maxRounds: number;
  gameEnded: boolean;
  roundOutcome: string;
}

export interface PlayerState {
  roundsWon: number;
  selectedWeapon: string;
  ready: boolean;
}

export interface MechanicState {
  game: GameState;
  [playerAlias: \`player\${number}\`]: PlayerState;
}

export type CallLLM = (prompt: string) => Promise<string>;

export interface MechanicResult {
  game?: Partial<GameState>;
  [playerAlias: \`player\${number}\`]: Partial<PlayerState>;
  publicMessage?: string;
  privateMessages?: Record<string, string>;
}
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('tsc-validator', () => {
  it('valid mechanic passes', () => {
    const source = `
export async function resolve_round(
  state: MechanicState,
  callLLM: CallLLM
): Promise<MechanicResult> {
  const round = state.game.currentRound;
  return {
    game: { currentRound: round + 1 },
    publicMessage: "Round resolved!",
  };
}
`;
    const result = validateMechanics(STATE_INTERFACES, { resolve_round: source });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('nonexistent field (TS2339)', () => {
    const source = `
export async function bad_field(
  state: MechanicState,
  callLLM: CallLLM
): Promise<MechanicResult> {
  const hp = state.game.health;
  return { game: { currentRound: 1 } };
}
`;
    const result = validateMechanics(STATE_INTERFACES, { bad_field: source });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);

    const err = result.errors.find((e) => e.code === 2339);
    expect(err).toBeDefined();
    expect(err!.mechanicId).toBe('bad_field');
    expect(err!.message).toContain('health');
  });

  it('type mismatch (TS2322)', () => {
    const source = `
export async function type_mismatch(
  state: MechanicState,
  callLLM: CallLLM
): Promise<MechanicResult> {
  return { game: { currentRound: "next" } };
}
`;
    const result = validateMechanics(STATE_INTERFACES, { type_mismatch: source });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);

    const err = result.errors.find((e) => e.code === 2322);
    expect(err).toBeDefined();
    expect(err!.mechanicId).toBe('type_mismatch');
  });

  it('wrong callLLM usage (TS2345)', () => {
    const source = `
export async function bad_call(
  state: MechanicState,
  callLLM: CallLLM
): Promise<MechanicResult> {
  const result = await callLLM(42 as any as string);
  return { publicMessage: result };
}
`;
    // Using `42 as any as string` defeats the purpose — use a raw number instead
    const directSource = `
export async function bad_call(
  state: MechanicState,
  callLLM: CallLLM
): Promise<MechanicResult> {
  const result = await callLLM(42);
  return { publicMessage: result };
}
`;
    const result = validateMechanics(STATE_INTERFACES, { bad_call: directSource });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);

    const err = result.errors.find((e) => e.code === 2345);
    expect(err).toBeDefined();
    expect(err!.mechanicId).toBe('bad_call');
  });

  it('multiple errors in one mechanic', () => {
    const source = `
export async function multi_error(
  state: MechanicState,
  callLLM: CallLLM
): Promise<MechanicResult> {
  const hp = state.game.health;
  const name = state.game.playerName;
  return { game: { currentRound: "wrong" } };
}
`;
    const result = validateMechanics(STATE_INTERFACES, { multi_error: source });
    expect(result.valid).toBe(false);
    // At least 3 errors: 2x TS2339 (health, playerName) + 1x TS2322 (currentRound)
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
    expect(result.errors.every((e) => e.mechanicId === 'multi_error')).toBe(true);
  });

  it('multiple mechanics, one invalid', () => {
    const goodSource = `
export async function good_mech(
  state: MechanicState,
  callLLM: CallLLM
): Promise<MechanicResult> {
  return { game: { currentRound: state.game.currentRound + 1 } };
}
`;
    const badSource = `
export async function bad_mech(
  state: MechanicState,
  callLLM: CallLLM
): Promise<MechanicResult> {
  return { game: { currentRound: "oops" } };
}
`;
    const result = validateMechanics(STATE_INTERFACES, {
      good_mech: goodSource,
      bad_mech: badSource,
    });
    expect(result.valid).toBe(false);
    // Only the bad mechanic should have errors
    expect(result.errors.every((e) => e.mechanicId === 'bad_mech')).toBe(true);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  it('field name typo with suggestion (TS2551)', () => {
    const source = `
export async function typo_field(
  state: MechanicState,
  callLLM: CallLLM
): Promise<MechanicResult> {
  const round = state.game.curentRound;
  return { game: { currentRound: 1 } };
}
`;
    const result = validateMechanics(STATE_INTERFACES, { typo_field: source });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);

    const err = result.errors.find((e) => e.code === 2551);
    expect(err).toBeDefined();
    expect(err!.mechanicId).toBe('typo_field');
    expect(err!.message).toContain('currentRound');
  });

  it('completes validation of multiple mechanics within performance target', () => {
    // Generate 10 valid mechanic sources
    const mechanics: Record<string, string> = {};
    for (let i = 0; i < 10; i++) {
      mechanics[`perf_mech_${i}`] = `
export async function perf_mech_${i}(
  state: MechanicState,
  callLLM: CallLLM
): Promise<MechanicResult> {
  return { game: { currentRound: state.game.currentRound + ${i} } };
}
`;
    }

    const start = performance.now();
    const result = validateMechanics(STATE_INTERFACES, mechanics);
    const elapsed = performance.now() - start;

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    // Performance target: <500ms for 5-10 mechanic files
    expect(elapsed).toBeLessThan(500);
  });
});
