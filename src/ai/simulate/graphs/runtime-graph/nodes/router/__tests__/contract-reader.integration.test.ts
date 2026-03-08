/**
 * Integration test: Live blockchain reads via contract-reader + datasource-utils
 *
 * These tests hit REAL RPCs (Arbitrum mainnet) — no mocks.
 * They verify the full pipeline:
 *   setFromDataSource op → contract-reader (viem) → transform → set op
 *
 * Skipped in CI (no INTEGRATION env var). Run manually:
 *   INTEGRATION=1 node --experimental-vm-modules node_modules/jest/bin/jest.js \
 *     src/ai/simulate/graphs/runtime-graph/nodes/router/__tests__/contract-reader.integration.test.ts
 */

import { describe, it, expect } from '@jest/globals';
import { createContractReader } from '../contract-reader.js';
import { processStateDeltaWithDataSources, applyTransform } from '../datasource-utils.js';
import { PREDEFINED_DATA_SOURCES } from '#chaincraft/ai/design/data-sources.js';

const SKIP = !process.env.INTEGRATION;
const describeIntegration = SKIP ? describe.skip : describe;

describeIntegration('Contract Reader Integration (live RPC)', () => {

  // ─── Raw contract-reader ─────────────────────────────────────────────────

  it('should read Chainlink TSLA/USD latestRoundData from Arbitrum mainnet', async () => {
    const reader = createContractReader();

    const tslaSource = PREDEFINED_DATA_SOURCES['chainlink-tsla-usd'];
    expect(tslaSource).toBeDefined();

    const raw = await reader({
      chainId: tslaSource.chainId,
      rpcUrl: tslaSource.rpcUrl,
      contract: tslaSource.contract,
      method: tslaSource.method,
      abi: tslaSource.abi,
      params: [],
    });

    console.log('[integration] Raw latestRoundData:', raw);

    // Chainlink returns a tuple-like object/array with named fields
    // The 'answer' field is the price in 8-decimal fixed point
    expect(raw).toBeDefined();

    // Apply the transform to get the USD price
    const price = applyTransform(raw, tslaSource.transform);
    console.log(`[integration] TSLA/USD price: $${price}`);

    // Sanity: TSLA should be between $1 and $10,000
    expect(typeof price).toBe('number');
    expect(price).toBeGreaterThan(1);
    expect(price).toBeLessThan(10000);
  }, 15000);

  // ─── Full pipeline: setFromDataSource → set ──────────────────────────────

  it('should process setFromDataSource end-to-end with Chainlink TSLA/USD', async () => {
    const reader = createContractReader();

    const ops = [
      { op: 'set', path: 'game.round', value: 1 },
      {
        op: 'setFromDataSource',
        dataSourceId: 'chainlink-tsla-usd',
        path: 'game.tslaPrice',
      },
      { op: 'increment', path: 'game.score', value: 10 },
    ];

    const result = await processStateDeltaWithDataSources(
      ops,
      PREDEFINED_DATA_SOURCES,
      {},
      reader
    );

    console.log('[integration] Processed stateDelta:', JSON.stringify(result, null, 2));

    // Should have 3 ops: original set, converted set (from datasource), original increment
    expect(result).toHaveLength(3);

    // First op unchanged
    expect(result[0]).toEqual({ op: 'set', path: 'game.round', value: 1 });

    // Second op: setFromDataSource → set with real price
    expect(result[1].op).toBe('set');
    expect(result[1].path).toBe('game.tslaPrice');
    expect(typeof result[1].value).toBe('number');
    expect(result[1].value).toBeGreaterThan(1);
    expect(result[1].value).toBeLessThan(10000);

    // Third op unchanged
    expect(result[2]).toEqual({ op: 'increment', path: 'game.score', value: 10 });

    console.log(`[integration] ✅ TSLA price set to $${result[1].value}`);
  }, 15000);

  // ─── Error handling: missing rpcUrl ──────────────────────────────────────

  it('should throw when rpcUrl is missing', async () => {
    const reader = createContractReader();

    await expect(
      reader({
        chainId: 42161,
        contract: '0x3609baAa0a9b1f0FE4d6CC01884585d0e191C3E3',
        method: 'latestRoundData',
        abi: PREDEFINED_DATA_SOURCES['chainlink-tsla-usd'].abi,
        params: [],
      })
    ).rejects.toThrow('No rpcUrl provided');
  });
});
