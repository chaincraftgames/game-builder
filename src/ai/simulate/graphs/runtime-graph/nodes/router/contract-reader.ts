/**
 * Production ContractReader implementation using viem.
 *
 * Provides a concrete implementation of the ContractReader interface
 * that reads blockchain contract state via JSON-RPC using viem.
 *
 * Uses viem rather than thirdweb for a smaller server-side footprint.
 * The API surface is nearly identical — both use readContract with
 * address, abi, functionName, and args.
 */

import { createPublicClient, http } from 'viem';
import type { ContractReader } from './datasource-utils.js';

/**
 * Create a production ContractReader that calls blockchain contracts
 * via viem's readContract.
 *
 * Each call creates a lightweight public client scoped to the chain's
 * RPC URL. Viem clients are cheap to create and don't hold connections,
 * so this avoids managing a client cache per chainId.
 *
 * @returns A ContractReader function suitable for processStateDeltaWithDataSources
 */
export function createContractReader(): ContractReader {
  return async ({ chainId, rpcUrl, contract, method, abi, params }) => {
    if (!rpcUrl) {
      throw new Error(
        `[contract-reader] No rpcUrl provided for chainId ${chainId}. ` +
        `Ensure the data source config includes an rpcUrl.`
      );
    }

    const client = createPublicClient({
      transport: http(rpcUrl),
    });

    const result = await client.readContract({
      address: contract as `0x${string}`,
      abi,
      functionName: method,
      args: params,
    });

    // Viem returns multi-output functions (e.g. Chainlink latestRoundData)
    // as plain arrays. Map to named object using ABI output definitions
    // so extractField transforms work by name (e.g. "answer").
    if (Array.isArray(result) && abi[0]?.outputs?.length > 1) {
      const outputs = abi[0].outputs;
      const named: Record<string, any> = {};
      outputs.forEach((out: any, i: number) => {
        named[out.name || `_${i}`] = result[i];
      });
      return named;
    }

    return result;
  };
}
