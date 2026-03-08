/**
 * Tests for Data Source utilities
 *
 * Tests the pre-processor that converts setFromDataSource ops into
 * standard set ops by calling blockchain contracts and applying transforms.
 */

import { jest, describe, it, expect } from '@jest/globals';
import {
  processDataSourceInstructions,
  processStateDeltaWithDataSources,
  resolveTemplateValue,
  applyTransform,
  type DataSourceReader,
} from '../datasource-utils.js';
import type { BlockchainDataSourceConfig, DataSourceConfig } from '../../../../../../design/game-design-state.js';

// ─── Test Fixtures ───────────────────────────────────────────────────────────

/** Chainlink-style price feed: returns a tuple, needs extractField + decimals */
const chainlinkTslaUsd: BlockchainDataSourceConfig = {
  sourceType: 'blockchain',
  id: 'chainlink-tsla-usd',
  label: 'TSLA Stock Price (Chainlink)',
  description: 'TSLA/USD price on Arbitrum',
  chain: 'Arbitrum',
  chainId: 42161,
  rpcUrl: 'https://arb1.arbitrum.io/rpc',
  contract: '0x3609baAa0a9b1f0FE4d6CC01884585d0e191C3E3',
  method: 'latestRoundData',
  abi: [{
    type: 'function',
    name: 'latestRoundData',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
    stateMutability: 'view',
  }],
  params: [],
  returnType: 'tuple',
  resultType: 'number',
  transform: {
    extractField: 'answer',
    decimals: 8,
  },
};

/** ERC-20 balance: needs decimals only */
const ccTokenBalance: BlockchainDataSourceConfig = {
  sourceType: 'blockchain',
  id: 'cc-token-balance',
  label: 'CC Token Balance',
  description: 'CC ERC-20 balance',
  chain: 'Arbitrum Sepolia',
  chainId: 421614,
  contract: '0xCC0000000000000000000000000000000000000001',
  method: 'balanceOf',
  abi: [{
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  }],
  params: [
    { name: 'account', type: 'address', description: 'Wallet address' },
  ],
  returnType: 'uint256',
  resultType: 'number',
  transform: { decimals: 18 },
};

/** Boolean return with no transform */
const faucetCanClaim: BlockchainDataSourceConfig = {
  sourceType: 'blockchain',
  id: 'faucet-can-claim',
  label: 'Faucet Claim Available',
  description: 'Can the player claim tokens?',
  chain: 'Arbitrum Sepolia',
  chainId: 421614,
  contract: '0xFAUCET0000000000000000000000000000000001',
  method: 'canClaim',
  abi: [{
    type: 'function',
    name: 'canClaim',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  }],
  params: [
    { name: 'user', type: 'address', description: 'Wallet address' },
  ],
  returnType: 'bool',
  resultType: 'boolean',
};

const DATA_SOURCES: Record<string, DataSourceConfig> = {
  'chainlink-tsla-usd': chainlinkTslaUsd,
  'cc-token-balance': ccTokenBalance,
  'faucet-can-claim': faucetCanClaim,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Data Source Utils', () => {
  describe('resolveTemplateValue', () => {
    const state = {
      game: { round: 3 },
      players: {
        p1: { walletAddress: '0xABCD', score: 42 },
        p2: { walletAddress: '0x1234' },
      },
    };

    it('should resolve a simple template variable', () => {
      expect(resolveTemplateValue('{{players.p1.walletAddress}}', state)).toBe('0xABCD');
    });

    it('should resolve nested paths', () => {
      expect(resolveTemplateValue('{{game.round}}', state)).toBe('3');
    });

    it('should return literal values unchanged', () => {
      expect(resolveTemplateValue('0xDEAD', state)).toBe('0xDEAD');
    });

    it('should return raw template if path is unresolvable', () => {
      expect(resolveTemplateValue('{{game.nonexistent}}', state)).toBe('{{game.nonexistent}}');
    });

    it('should handle partial template syntax as literal', () => {
      expect(resolveTemplateValue('{{incomplete', state)).toBe('{{incomplete');
    });
  });

  describe('applyTransform', () => {
    it('should return raw value when no transform provided', () => {
      expect(applyTransform(12345, undefined)).toBe(12345);
    });

    it('should extract a named field', () => {
      const raw = { roundId: 1n, answer: 24835000000n, startedAt: 100n, updatedAt: 200n, answeredInRound: 1n };
      expect(applyTransform(raw, { extractField: 'answer' })).toBe(24835000000n);
    });

    it('should apply decimal normalization', () => {
      expect(applyTransform(24835000000, { decimals: 8 })).toBeCloseTo(248.35);
    });

    it('should apply extractField then decimals', () => {
      const raw = { answer: 24835000000 };
      const result = applyTransform(raw, { extractField: 'answer', decimals: 8 });
      expect(result).toBeCloseTo(248.35);
    });

    it('should handle BigInt values in decimal normalization', () => {
      const raw = 1000000000000000000n; // 1e18
      expect(applyTransform(raw, { decimals: 18 })).toBeCloseTo(1.0);
    });

    it('should handle nested extractField with dot notation', () => {
      const raw = { result: { price: 42 } };
      expect(applyTransform(raw, { extractField: 'result.price' })).toBe(42);
    });

    it('should warn and return value if extract target is not an object', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const result = applyTransform('notAnObject', { extractField: 'field' });
      expect(result).toBe('notAnObject');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not an object'));
      warnSpy.mockRestore();
    });

    // ─── New transform extensions ─────────────────────────────────────────

    it('should pick an element using arrayIndex', () => {
      const raw = ['first', 'second', 'third'];
      expect(applyTransform(raw, { arrayIndex: 1 })).toBe('second');
    });

    it('should apply arrayIndex then extractField', () => {
      // Simulates Binance kline: array of arrays where each inner array
      // has [openTime, open, high, low, close, ...]
      const raw = [[1710000000000, '87000', '87500', '86500', '87250']];
      const result = applyTransform(raw, { arrayIndex: 0, extractField: '4' });
      expect(result).toBe('87250');
    });

    it('should warn if arrayIndex target is not an array', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const result = applyTransform({ notArray: true }, { arrayIndex: 0 });
      expect(result).toEqual({ notArray: true }); // unchanged
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not an array'));
      warnSpy.mockRestore();
    });

    it('should coerce a numeric string to number', () => {
      expect(applyTransform('87250.50', { coerceNumber: true })).toBe(87250.50);
    });

    it('should coerce after extractField', () => {
      const raw = { price: '3450.25' };
      const result = applyTransform(raw, { extractField: 'price', coerceNumber: true });
      expect(result).toBe(3450.25);
    });

    it('should warn and keep original if coerceNumber fails', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const result = applyTransform('not-a-number', { coerceNumber: true });
      expect(result).toBe('not-a-number');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('coerceNumber failed'));
      warnSpy.mockRestore();
    });

    it('should apply full pipeline: arrayIndex → extractField → decimals → coerceNumber', () => {
      // Contrived but tests the full chain
      const raw = [{ answer: 24835000000 }];
      const result = applyTransform(raw, {
        arrayIndex: 0,
        extractField: 'answer',
        decimals: 8,
      });
      expect(result).toBeCloseTo(248.35);
    });
  });

  describe('processStateDeltaWithDataSources', () => {
    const gameState = {
      game: { round: 1 },
      players: {
        p1: { walletAddress: '0xABCD' },
      },
    };

    it('should pass through non-datasource ops unchanged', async () => {
      const ops = [
        { op: 'set', path: 'game.round', value: 2 },
        { op: 'increment', path: 'game.score', value: 10 },
      ];

      const mockReader: DataSourceReader = jest.fn();

      const result = await processStateDeltaWithDataSources(ops, DATA_SOURCES, gameState, mockReader);
      expect(result).toEqual(ops);
      expect(mockReader).not.toHaveBeenCalled();
    });

    it('should convert Chainlink setFromDataSource to set op with transform', async () => {
      const ops = [
        {
          op: 'setFromDataSource',
          dataSourceId: 'chainlink-tsla-usd',
          path: 'game.tslaPrice',
        },
      ];

      const mockReader: DataSourceReader = jest.fn().mockResolvedValue({
        roundId: 110680464442257310000n,
        answer: 24835000000n,
        startedAt: 1710000000n,
        updatedAt: 1710000100n,
        answeredInRound: 110680464442257310000n,
      });

      const result = await processStateDeltaWithDataSources(ops, DATA_SOURCES, gameState, mockReader);

      expect(result).toHaveLength(1);
      expect(result[0].op).toBe('set');
      expect(result[0].path).toBe('game.tslaPrice');
      expect(result[0].value).toBeCloseTo(248.35);

      expect(mockReader).toHaveBeenCalledWith(
        chainlinkTslaUsd,  // full config object
        {},                // paramValues (empty for latestRoundData)
        gameState,
      );
    });

    it('should resolve template variables in paramValues', async () => {
      const ops = [
        {
          op: 'setFromDataSource',
          dataSourceId: 'cc-token-balance',
          path: 'players.p1.tokenBalance',
          paramValues: { account: '{{players.p1.walletAddress}}' },
        },
      ];

      const mockReader: DataSourceReader = jest.fn().mockResolvedValue(5000000000000000000n);

      const result = await processStateDeltaWithDataSources(ops, DATA_SOURCES, gameState, mockReader);

      expect(result).toHaveLength(1);
      expect(result[0].op).toBe('set');
      expect(result[0].path).toBe('players.p1.tokenBalance');
      expect(result[0].value).toBeCloseTo(5.0);

      // Verify the template variable was resolved in paramValues
      expect(mockReader).toHaveBeenCalledWith(
        ccTokenBalance,
        { account: '{{players.p1.walletAddress}}' },
        gameState,
      );
    });

    it('should handle literal paramValues (no template)', async () => {
      const ops = [
        {
          op: 'setFromDataSource',
          dataSourceId: 'faucet-can-claim',
          path: 'game.canClaim',
          paramValues: { user: '0xDEADBEEF' },
        },
      ];

      const mockReader: DataSourceReader = jest.fn().mockResolvedValue(true);

      const result = await processStateDeltaWithDataSources(ops, DATA_SOURCES, gameState, mockReader);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ op: 'set', path: 'game.canClaim', value: true });
      expect(mockReader).toHaveBeenCalledWith(
        faucetCanClaim,
        { user: '0xDEADBEEF' },
        gameState,
      );
    });

    it('should skip unknown data source IDs and log error', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      const ops = [
        {
          op: 'setFromDataSource',
          dataSourceId: 'nonexistent-source',
          path: 'game.value',
        },
      ];

      const mockReader: DataSourceReader = jest.fn();

      const result = await processStateDeltaWithDataSources(ops, DATA_SOURCES, gameState, mockReader);

      expect(result).toHaveLength(0); // Skipped
      expect(mockReader).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown data source ID: "nonexistent-source"')
      );

      errorSpy.mockRestore();
    });

    it('should skip op and log error on contract read failure', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      const ops = [
        {
          op: 'setFromDataSource',
          dataSourceId: 'chainlink-tsla-usd',
          path: 'game.tslaPrice',
        },
      ];

      const mockReader: DataSourceReader = jest.fn().mockRejectedValue(
        new Error('RPC timeout')
      );

      const result = await processStateDeltaWithDataSources(ops, DATA_SOURCES, gameState, mockReader);

      expect(result).toHaveLength(0); // Skipped due to error
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read data source "chainlink-tsla-usd"')
      );

      errorSpy.mockRestore();
    });

    it('should handle mixed ops — datasource and regular', async () => {
      const ops = [
        { op: 'set', path: 'game.round', value: 2 },
        {
          op: 'setFromDataSource',
          dataSourceId: 'chainlink-tsla-usd',
          path: 'game.tslaPrice',
        },
        { op: 'increment', path: 'game.score', value: 5 },
      ];

      const mockReader: DataSourceReader = jest.fn().mockResolvedValue({
        answer: 30000000000,
      });

      const result = await processStateDeltaWithDataSources(ops, DATA_SOURCES, gameState, mockReader);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ op: 'set', path: 'game.round', value: 2 });
      expect(result[1]).toEqual({ op: 'set', path: 'game.tslaPrice', value: expect.closeTo(300.0) });
      expect(result[2]).toEqual({ op: 'increment', path: 'game.score', value: 5 });
    });

    it('should return empty/null input unchanged', async () => {
      const mockReader: DataSourceReader = jest.fn();
      expect(await processStateDeltaWithDataSources([], DATA_SOURCES, {}, mockReader)).toEqual([]);
      expect(await processStateDeltaWithDataSources(null as any, DATA_SOURCES, {}, mockReader)).toBeNull();
    });
  });

  describe('processDataSourceInstructions', () => {
    it('should return instructions unchanged if no stateDelta', async () => {
      const instructions = { phase: 'test', messages: { public: { to: 'all', template: 'test' } } };
      const mockReader: DataSourceReader = jest.fn();

      const result = await processDataSourceInstructions(instructions, DATA_SOURCES, {}, mockReader);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual(instructions);
      expect(mockReader).not.toHaveBeenCalled();
    });

    it('should process setFromDataSource ops within instructions object', async () => {
      const instructions = {
        phase: 'market_update',
        stateDelta: [
          {
            op: 'setFromDataSource',
            dataSourceId: 'chainlink-tsla-usd',
            path: 'game.tslaPrice',
          },
        ],
      };

      const mockReader: DataSourceReader = jest.fn().mockResolvedValue({
        answer: 15000000000,
      });

      const result = await processDataSourceInstructions(
        instructions,
        DATA_SOURCES,
        {},
        mockReader
      );
      const parsed = JSON.parse(result);

      expect(parsed.phase).toBe('market_update');
      expect(parsed.stateDelta[0]).toEqual({
        op: 'set',
        path: 'game.tslaPrice',
        value: expect.closeTo(150.0),
      });
    });

    it('should handle string input', async () => {
      const instructions = JSON.stringify({
        stateDelta: [
          {
            op: 'setFromDataSource',
            dataSourceId: 'faucet-can-claim',
            path: 'game.canClaim',
            paramValues: { user: '0xABCD' },
          },
        ],
      });

      const mockReader: DataSourceReader = jest.fn().mockResolvedValue(false);

      const result = await processDataSourceInstructions(instructions, DATA_SOURCES, {}, mockReader);
      const parsed = JSON.parse(result);

      expect(parsed.stateDelta[0]).toEqual({
        op: 'set',
        path: 'game.canClaim',
        value: false,
      });
    });
  });
});
