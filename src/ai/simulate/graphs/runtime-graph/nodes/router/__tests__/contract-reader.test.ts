/**
 * Tests for the production ContractReader (contract-reader.ts)
 *
 * Tests the array→named-object mapping for multi-output ABI functions.
 * Uses a mock viem client to avoid live RPC calls.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// We test the mapping logic by importing createContractReader and mocking viem
// Since viem is an external dep, we mock it at module level.
jest.unstable_mockModule('viem', () => ({
  createPublicClient: jest.fn(),
  http: jest.fn(),
}));

const { createPublicClient, http } = await import('viem');
const { createContractReader } = await import('../contract-reader.js');

describe('createContractReader', () => {
  const chainlinkAbi = [{
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
  }];

  const singleOutputAbi = [{
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  }];

  let mockReadContract: jest.MockedFunction<any>;

  beforeEach(() => {
    mockReadContract = jest.fn();
    (createPublicClient as jest.MockedFunction<any>).mockReturnValue({
      readContract: mockReadContract,
    });
  });

  it('should map multi-output array to named object', async () => {
    // Viem returns a tuple as a plain array
    mockReadContract.mockResolvedValue([
      18446744073709564529n,  // roundId
      24835000000n,           // answer
      1710000000n,            // startedAt
      1710000100n,            // updatedAt
      18446744073709564529n,  // answeredInRound
    ]);

    const reader = createContractReader();
    const result = await reader({
      chainId: 42161,
      rpcUrl: 'https://arb1.arbitrum.io/rpc',
      contract: '0x3609baAa0a9b1f0FE4d6CC01884585d0e191C3E3',
      method: 'latestRoundData',
      abi: chainlinkAbi,
      params: [],
    });

    // Should be a named object, not an array
    expect(Array.isArray(result)).toBe(false);
    expect(result.roundId).toBe(18446744073709564529n);
    expect(result.answer).toBe(24835000000n);
    expect(result.startedAt).toBe(1710000000n);
    expect(result.updatedAt).toBe(1710000100n);
    expect(result.answeredInRound).toBe(18446744073709564529n);
  });

  it('should return single-output values as-is (no wrapping)', async () => {
    // Single-output functions return a scalar, not an array
    mockReadContract.mockResolvedValue(5000000000000000000n);

    const reader = createContractReader();
    const result = await reader({
      chainId: 421614,
      rpcUrl: 'https://arbitrum-sepolia-rpc.publicnode.com',
      contract: '0xCC00000000000000000000000000000000000001',
      method: 'balanceOf',
      abi: singleOutputAbi,
      params: ['0xABCD'],
    });

    expect(result).toBe(5000000000000000000n);
  });

  it('should pass through named objects unchanged', async () => {
    // If viem ever returns a named object (e.g. future version), it should pass through
    const namedResult = { roundId: 1n, answer: 100n, startedAt: 0n, updatedAt: 0n, answeredInRound: 1n };
    mockReadContract.mockResolvedValue(namedResult);

    const reader = createContractReader();
    const result = await reader({
      chainId: 42161,
      rpcUrl: 'https://arb1.arbitrum.io/rpc',
      contract: '0x3609baAa0a9b1f0FE4d6CC01884585d0e191C3E3',
      method: 'latestRoundData',
      abi: chainlinkAbi,
      params: [],
    });

    // Not an array, so mapping shouldn't apply
    expect(result).toEqual(namedResult);
  });

  it('should throw when rpcUrl is missing', async () => {
    const reader = createContractReader();

    await expect(
      reader({
        chainId: 42161,
        contract: '0x3609baAa0a9b1f0FE4d6CC01884585d0e191C3E3',
        method: 'latestRoundData',
        abi: chainlinkAbi,
        params: [],
      })
    ).rejects.toThrow('No rpcUrl provided');
  });

  it('should use fallback names for unnamed outputs', async () => {
    const abiWithUnnamedOutputs = [{
      type: 'function',
      name: 'getValues',
      inputs: [],
      outputs: [
        { name: '', type: 'uint256' },
        { name: 'label', type: 'string' },
        { name: '', type: 'bool' },
      ],
      stateMutability: 'view',
    }];

    mockReadContract.mockResolvedValue([42n, 'hello', true]);

    const reader = createContractReader();
    const result = await reader({
      chainId: 42161,
      rpcUrl: 'https://arb1.arbitrum.io/rpc',
      contract: '0x1234',
      method: 'getValues',
      abi: abiWithUnnamedOutputs,
      params: [],
    });

    expect(result._0).toBe(42n);
    expect(result.label).toBe('hello');
    expect(result._2).toBe(true);
  });
});
