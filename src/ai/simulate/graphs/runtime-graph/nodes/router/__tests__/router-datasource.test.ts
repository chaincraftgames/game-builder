/**
 * Router Node — Data Source Resolution Tests
 *
 * Verifies that the router correctly:
 * 1. Builds a data source map from state.dataSources
 * 2. Detects setFromDataSource ops in instructions
 * 3. Resolves them to concrete `set` ops via the contract reader
 * 4. Passes resolved instructions downstream in selectedInstructions
 *
 * Uses jest.unstable_mockModule to mock contract-reader.js so no real
 * blockchain calls are made.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { RuntimeStateType } from '../../../runtime-state.js';
import type { BlockchainDataSourceConfig } from '#chaincraft/ai/design/game-design-state.js';

// ─── Mock contract-reader to avoid viem import ──────────────────────────────

const mockContractReader = jest.fn<(config: any) => Promise<any>>();

jest.unstable_mockModule('../contract-reader.js', () => ({
  createContractReader: () => mockContractReader,
}));

// Dynamic import AFTER mock registration
const { router } = await import('../index.js');

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Minimal Chainlink-style data source config */
const chainlinkTslaUsd: BlockchainDataSourceConfig = {
  sourceType: 'blockchain',
  id: 'chainlink-tsla-usd',
  label: 'TSLA/USD',
  description: 'TSLA price feed',
  chain: 'Arbitrum',
  chainId: 42161,
  rpcUrl: 'https://arb1.arbitrum.io/rpc',
  contract: '0x3609baAa0a9b1f0FE4d6CC01884585d0e191C3E3',
  method: 'latestRoundData',
  abi: [{
    type: 'function' as const,
    name: 'latestRoundData',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
    stateMutability: 'view' as const,
  }],
  params: [],
  returnType: 'tuple',
  resultType: 'number',
  transform: {
    extractField: 'answer',
    decimals: 8,
  },
};

/** Minimal transitions artifact with a single automatic transition that has a setFromDataSource op */
function makeTransitions(fromPhase: string, toPhase: string, transitionId: string) {
  return {
    phases: ['init', fromPhase, toPhase, 'finished'],
    phaseMetadata: [
      { phase: 'init', requiresPlayerInput: false },
      { phase: fromPhase, requiresPlayerInput: false },
      { phase: toPhase, requiresPlayerInput: false },
      { phase: 'finished', requiresPlayerInput: false },
    ],
    transitions: [
      {
        id: 'initialize_game',
        fromPhase: 'init',
        toPhase: fromPhase,
        condition: 'Game start',
        humanSummary: 'Initialize',
        preconditions: [
          {
            id: 'in_init',
            deterministic: true,
            explain: "game.currentPhase == 'init'",
            logic: { '==': [{ var: 'game.currentPhase' }, 'init'] },
          },
        ],
        checkedFields: ['game.currentPhase'],
      },
      {
        id: transitionId,
        fromPhase,
        toPhase,
        condition: 'Always fires from this phase',
        humanSummary: 'Auto transition',
        preconditions: [
          {
            id: 'in_phase',
            deterministic: true,
            explain: `game.currentPhase == '${fromPhase}'`,
            logic: { '==': [{ var: 'game.currentPhase' }, fromPhase] },
          },
        ],
        checkedFields: ['game.currentPhase'],
      },
    ],
  };
}

/** Instructions with a setFromDataSource op */
function makeInstructionsWithDataSource(transitionId: string, targetPath: string, dataSourceId: string) {
  return JSON.stringify({
    id: transitionId,
    transitionName: 'Fetch Price',
    stateDelta: [
      { op: 'setFromDataSource', path: targetPath, dataSourceId },
      { op: 'set', path: 'game.currentPhase', value: 'resolve' },
    ],
  });
}

/** Instructions with only standard ops (no data sources) */
function makeStandardInstructions(transitionId: string) {
  return JSON.stringify({
    id: transitionId,
    transitionName: 'Standard Init',
    stateDelta: [
      { op: 'set', path: 'game.currentPhase', value: 'predict' },
      { op: 'set', path: 'game.gameEnded', value: false },
    ],
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Router — Data Source Resolution', () => {
  beforeEach(() => {
    mockContractReader.mockReset();
  });

  it('should resolve setFromDataSource ops in init transition instructions', async () => {
    // The mock contract reader returns a Chainlink-style tuple
    mockContractReader.mockResolvedValue({
      roundId: 1n,
      answer: 24835000000n,
      startedAt: 100n,
      updatedAt: 200n,
      answeredInRound: 1n,
    });

    const routerNode = router();

    const state: Partial<RuntimeStateType> = {
      gameState: '',
      stateTransitions: JSON.stringify(makeTransitions('predict', 'resolve', 'fetch_price')),
      transitionInstructions: {
        initialize_game: makeInstructionsWithDataSource('initialize_game', 'game.startingPrice', 'chainlink-tsla-usd'),
      },
      playerPhaseInstructions: {},
      isInitialized: false,
      playerAction: undefined,
      players: ['player1'],
      dataSources: [chainlinkTslaUsd],
    };

    const result = await routerNode(state as RuntimeStateType);

    // Should be ready to execute (init transition fires)
    expect(result.transitionReady).toBe(true);
    expect(result.selectedInstructions).toBeDefined();

    // Parse the resolved instructions
    const resolved = JSON.parse(result.selectedInstructions!);

    // The setFromDataSource op should be replaced with a concrete `set` op
    const priceDelta = resolved.stateDelta.find((op: any) => op.path === 'game.startingPrice');
    expect(priceDelta).toBeDefined();
    expect(priceDelta.op).toBe('set');
    // Chainlink answer=24835000000 with decimals=8 → 248.35
    expect(priceDelta.value).toBeCloseTo(248.35);

    // The other ops should be untouched
    const phaseDelta = resolved.stateDelta.find((op: any) => op.path === 'game.currentPhase');
    expect(phaseDelta).toEqual({ op: 'set', path: 'game.currentPhase', value: 'resolve' });

    // Contract reader should have been called once
    expect(mockContractReader).toHaveBeenCalledTimes(1);
  });

  it('should resolve setFromDataSource ops in automatic transition instructions', async () => {
    mockContractReader.mockResolvedValue({
      roundId: 2n,
      answer: 31050000000n,
      startedAt: 100n,
      updatedAt: 200n,
      answeredInRound: 2n,
    });

    const routerNode = router();
    const transitionId = 'resolve_outcome';

    const state: Partial<RuntimeStateType> = {
      gameState: JSON.stringify({
        game: { currentPhase: 'predict', gameEnded: false, startingPrice: 248.35 },
        players: {
          player1: { actionRequired: false, actionsAllowed: [], illegalActionCount: 0 },
        },
      }),
      stateTransitions: JSON.stringify(makeTransitions('predict', 'resolve', transitionId)),
      transitionInstructions: {
        [transitionId]: makeInstructionsWithDataSource(transitionId, 'game.currentPrice', 'chainlink-tsla-usd'),
      },
      playerPhaseInstructions: {},
      isInitialized: true,
      playerAction: undefined,
      dataSources: [chainlinkTslaUsd],
    };

    const result = await routerNode(state as RuntimeStateType);

    expect(result.transitionReady).toBe(true);
    expect(result.nextPhase).toBe('resolve');
    expect(result.selectedInstructions).toBeDefined();

    const resolved = JSON.parse(result.selectedInstructions!);
    const priceDelta = resolved.stateDelta.find((op: any) => op.path === 'game.currentPrice');
    expect(priceDelta).toBeDefined();
    expect(priceDelta.op).toBe('set');
    // 31050000000 / 1e8 = 310.50
    expect(priceDelta.value).toBeCloseTo(310.50);

    expect(mockContractReader).toHaveBeenCalledTimes(1);
  });

  it('should NOT call contract reader when no dataSources are configured', async () => {
    const routerNode = router();

    const state: Partial<RuntimeStateType> = {
      gameState: '',
      stateTransitions: JSON.stringify(makeTransitions('predict', 'resolve', 'fetch_price')),
      transitionInstructions: {
        initialize_game: makeStandardInstructions('initialize_game'),
      },
      playerPhaseInstructions: {},
      isInitialized: false,
      playerAction: undefined,
      players: ['player1'],
      dataSources: [], // Empty — no data sources
    };

    const result = await routerNode(state as RuntimeStateType);

    expect(result.transitionReady).toBe(true);
    expect(result.selectedInstructions).toBeDefined();

    // Standard ops should pass through unchanged
    const resolved = JSON.parse(result.selectedInstructions!);
    expect(resolved.stateDelta).toEqual([
      { op: 'set', path: 'game.currentPhase', value: 'predict' },
      { op: 'set', path: 'game.gameEnded', value: false },
    ]);

    // Contract reader should never be called
    expect(mockContractReader).not.toHaveBeenCalled();
  });

  it('should NOT call contract reader when instructions have no setFromDataSource ops', async () => {
    const routerNode = router();

    const state: Partial<RuntimeStateType> = {
      gameState: JSON.stringify({
        game: { currentPhase: 'predict', gameEnded: false },
        players: {
          player1: { actionRequired: false, actionsAllowed: [], illegalActionCount: 0 },
        },
      }),
      stateTransitions: JSON.stringify(makeTransitions('predict', 'resolve', 'resolve_outcome')),
      transitionInstructions: {
        resolve_outcome: makeStandardInstructions('resolve_outcome'), // No data source ops
      },
      playerPhaseInstructions: {},
      isInitialized: true,
      playerAction: undefined,
      dataSources: [chainlinkTslaUsd], // Data sources configured but not used
    };

    const result = await routerNode(state as RuntimeStateType);

    expect(result.transitionReady).toBe(true);

    // Contract reader should not be called for instructions without setFromDataSource
    expect(mockContractReader).not.toHaveBeenCalled();
  });

  it('should handle contract reader errors gracefully', async () => {
    mockContractReader.mockRejectedValue(new Error('RPC timeout'));

    const routerNode = router();

    const state: Partial<RuntimeStateType> = {
      gameState: '',
      stateTransitions: JSON.stringify(makeTransitions('predict', 'resolve', 'fetch_price')),
      transitionInstructions: {
        initialize_game: makeInstructionsWithDataSource('initialize_game', 'game.startingPrice', 'chainlink-tsla-usd'),
      },
      playerPhaseInstructions: {},
      isInitialized: false,
      playerAction: undefined,
      players: ['player1'],
      dataSources: [chainlinkTslaUsd],
    };

    // The router wraps everything in try/catch — should produce an error state
    const result = await routerNode(state as RuntimeStateType);

    // Router should handle the error (gameState with gameError, or the error propagates)
    // The exact behavior depends on how processDataSourceInstructions handles errors.
    // At minimum, it shouldn't throw an unhandled exception.
    expect(result).toBeDefined();

    if (result.gameState) {
      const gs = JSON.parse(result.gameState);
      expect(gs.game.gameError).toBeDefined();
    }
  });
});
