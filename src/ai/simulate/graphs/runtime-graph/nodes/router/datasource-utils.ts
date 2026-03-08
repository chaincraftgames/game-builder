/**
 * Data Source Utilities for Router
 *
 * Pre-processes setFromDataSource stateDelta operations by:
 * 1. Resolving template variables in paramValues from game state
 * 2. Reading from the appropriate source (blockchain contract or HTTP API)
 * 3. Optionally applying an aggregator pattern (e.g., delayed-comparison)
 * 4. Applying the data source's transform (arrayIndex, extractField, decimals, coerceNumber)
 * 5. Extracting a specific field from the result (op-level extractField)
 * 6. Converting to standard "set" operations with concrete values
 *
 * Follows the same pattern as rng-utils.ts — intercepts special ops
 * before they reach applySingleOp, converting them to plain "set" ops.
 *
 * Example setFromDataSource op (simple):
 * {
 *   "op": "setFromDataSource",
 *   "dataSourceId": "chainlink-tsla-usd",
 *   "path": "game.tslaPrice",
 *   "paramValues": {}
 * }
 *
 * Example setFromDataSource op (with aggregator):
 * {
 *   "op": "setFromDataSource",
 *   "dataSourceId": "binance-btc-usd-price",
 *   "aggregatorId": "30s-movement",
 *   "path": "game.openingPrice",
 *   "extractField": "startValue"
 * }
 *
 * After pre-processing:
 * {
 *   "op": "set",
 *   "path": "game.openingPrice",
 *   "value": 67339.73
 * }
 */

import type { DataSourceConfig, DataSourceTransform, BlockchainDataSourceConfig, DataSourceAggregatorConfig } from '../../../../../design/game-design-state.js';
import { getAggregatorById } from '../../../../../design/data-sources.js';

/**
 * The contract reader function signature.
 * Abstracted to allow dependency injection for testing.
 * In production, this wraps viem's readContract.
 */
export type ContractReader = (config: {
  chainId: number;
  rpcUrl?: string;
  contract: string;
  method: string;
  abi: any[];
  params: any[];
}) => Promise<any>;

/**
 * Unified data source reader that dispatches to the appropriate
 * backend (blockchain or HTTP) based on the config's sourceType.
 * Injected into processStateDeltaWithDataSources for testability.
 */
export type DataSourceReader = (
  config: DataSourceConfig,
  paramValues: Record<string, string>,
  state: any
) => Promise<any>;

/**
 * Resolve template variables like "{{playerAddress}}" from game state.
 * Supports dot-notation paths within the template: {{players.p1.walletAddress}}
 */
export function resolveTemplateValue(template: string, state: any): string {
  const match = template.match(/^\{\{(.+?)\}\}$/);
  if (!match) {
    // Not a template — return as literal value
    return template;
  }

  const path = match[1];
  const segments = path.split('.');
  let current = state;
  for (const seg of segments) {
    if (current == null) return template; // Unresolvable — return raw
    current = current[seg];
  }

  if (current == null) {
    console.warn(`[datasource-utils] Template variable {{${path}}} resolved to null/undefined`);
    return template;
  }

  return String(current);
}

/**
 * Apply the data source's transform pipeline to the raw response value.
 *
 * Execution order:
 * 1. arrayIndex — pick element from an array response
 * 2. extractField — pull a named field from an object/tuple
 * 3. decimals — divide by 10^decimals for normalization
 * 4. coerceNumber — parseFloat for APIs that return numbers as strings
 */
export function applyTransform(
  rawValue: any,
  transform: DataSourceTransform | undefined
): any {
  if (!transform) return rawValue;

  let value = rawValue;

  // 1. Array index selection (e.g., kline candle arrays)
  if (transform.arrayIndex != null) {
    if (!Array.isArray(value)) {
      console.warn(
        `[datasource-utils] arrayIndex(${transform.arrayIndex}) — value is not an array`
      );
    } else {
      value = value[transform.arrayIndex];
    }
  }

  // 2. Extract field from object/tuple
  if (transform.extractField) {
    const fields = transform.extractField.split('.');
    for (const field of fields) {
      if (value == null || typeof value !== 'object') {
        console.warn(
          `[datasource-utils] Cannot extract field "${transform.extractField}" — value is not an object`
        );
        return value;
      }
      value = value[field];
    }
  }

  // 3. Decimal normalization
  if (transform.decimals != null && transform.decimals > 0) {
    const num = typeof value === 'bigint' ? Number(value) : Number(value);
    if (isNaN(num)) {
      console.warn(
        `[datasource-utils] Cannot apply decimal normalization — value "${value}" is not numeric`
      );
      return value;
    }
    value = num / Math.pow(10, transform.decimals);
  }

  // 4. Coerce to number (for APIs returning numeric strings like Binance)
  if (transform.coerceNumber) {
    const num = parseFloat(value);
    if (isNaN(num)) {
      console.warn(
        `[datasource-utils] coerceNumber failed — value "${value}" is not parseable as a number`
      );
    } else {
      value = num;
    }
  }

  return value;
}

/**
 * Build the ordered argument array for a blockchain contract call from paramValues
 * and the data source's param definitions.
 */
export function buildCallArgs(
  dataSource: DataSourceConfig,
  paramValues: Record<string, string>,
  state: any
): any[] {
  return dataSource.params.map((paramDef: { name: string; type: string }) => {
    const raw = paramValues[paramDef.name];
    if (raw == null) {
      console.warn(
        `[datasource-utils] Missing param value for "${paramDef.name}" on data source "${dataSource.id}"`
      );
      return undefined;
    }
    return resolveTemplateValue(raw, state);
  });
}

/**
 * Process an array of stateDelta operations, resolving setFromDataSource ops
 * into standard "set" ops with concrete values from data source reads.
 *
 * When an op specifies an aggregatorId, the aggregator pattern is applied:
 * - delayed-comparison: read source → sleep(delayMs) → read again → compute metrics
 * - Per-call cache ensures multiple ops referencing the same aggregator+source
 *   reuse the same result (e.g., one op extracts startValue, another endValue)
 *
 * Non-datasource ops are passed through unchanged.
 *
 * @param stateDelta - Array of stateDelta operations (may include setFromDataSource)
 * @param dataSources - Map of data source ID → config (from design state)
 * @param state - Current game state (for template variable resolution)
 * @param reader - Unified data source reader (dispatches to blockchain or HTTP)
 * @returns Array with setFromDataSource ops replaced by set ops
 */
export async function processStateDeltaWithDataSources(
  stateDelta: any[],
  dataSources: Record<string, DataSourceConfig>,
  state: any,
  reader: DataSourceReader
): Promise<any[]> {
  if (!stateDelta || stateDelta.length === 0) {
    return stateDelta;
  }

  // Per-call cache for aggregator results.
  // Key: "aggregatorId::dataSourceId" — ensures multiple ops extracting
  // different fields from the same aggregator+source reuse one result.
  const aggregatorCache = new Map<string, any>();

  const result: any[] = [];

  for (const operation of stateDelta) {
    if (operation.op !== 'setFromDataSource') {
      result.push(operation);
      continue;
    }

    const { dataSourceId, path, paramValues = {}, aggregatorId, extractField } = operation;

    // Look up data source config
    const dataSource = dataSources[dataSourceId];
    if (!dataSource) {
      console.error(
        `[datasource-utils] Unknown data source ID: "${dataSourceId}". ` +
        `Operation will be skipped.`
      );
      continue;
    }

    try {
      let value: any;

      if (aggregatorId) {
        // ─── Aggregated read ─────────────────────────────────────
        const aggregator = getAggregatorById(aggregatorId);
        if (!aggregator) {
          console.error(
            `[datasource-utils] Unknown aggregator ID: "${aggregatorId}". ` +
            `Operation will be skipped.`
          );
          continue;
        }

        const cacheKey = `${aggregatorId}::${dataSourceId}`;

        if (aggregatorCache.has(cacheKey)) {
          value = aggregatorCache.get(cacheKey);
          console.log(
            `[datasource-utils] Cache hit for ${cacheKey}`
          );
        } else {
          value = await executeAggregator(
            aggregator,
            dataSource,
            paramValues,
            state,
            reader
          );
          aggregatorCache.set(cacheKey, value);
        }

        // Extract field from aggregator result
        if (extractField && value != null && typeof value === 'object') {
          value = value[extractField];
        }
      } else {
        // ─── Simple read (no aggregator) ─────────────────────────
        const rawValue = await reader(dataSource, paramValues, state);
        value = applyTransform(rawValue, dataSource.transform);

        // Op-level extractField (rare without aggregator, but supported)
        if (extractField && value != null && typeof value === 'object') {
          value = value[extractField];
        }
      }

      console.log(
        `[datasource-utils] ${dataSource.id}${aggregatorId ? ` (${aggregatorId})` : ''} → ${path}: ${JSON.stringify(value)}`
      );

      // Convert to standard set operation
      result.push({
        op: 'set',
        path,
        value,
      });
    } catch (err: any) {
      console.error(
        `[datasource-utils] Failed to read data source "${dataSourceId}"${aggregatorId ? ` with aggregator "${aggregatorId}"` : ''}: ${err.message || err}`
      );
      // Skip the op — don't crash the whole delta array
      continue;
    }
  }

  return result;
}

// ─── Aggregator Execution ──────────────────────────────────────────────────

/**
 * Sleep for a given number of milliseconds.
 * Extracted for testability (can be mocked in tests).
 */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Execute a delayed-comparison aggregator:
 * 1. Read the underlying source → startValue
 * 2. Sleep for delayMs
 * 3. Read again → endValue
 * 4. Compute deterministic metrics
 *
 * Returns: { startValue, endValue, direction, delta, pctChange }
 */
async function executeAggregator(
  aggregator: DataSourceAggregatorConfig,
  dataSource: DataSourceConfig,
  paramValues: Record<string, string>,
  state: any,
  reader: DataSourceReader
): Promise<Record<string, any>> {
  if (aggregator.type === 'delayed-comparison') {
    // First read
    const rawStart = await reader(dataSource, paramValues, state);
    const startValue = applyTransform(rawStart, dataSource.transform);
    console.log(
      `[datasource-utils] Aggregator "${aggregator.id}" first read from "${dataSource.id}": ${startValue}`
    );

    // Delay
    console.log(
      `[datasource-utils] Aggregator "${aggregator.id}" waiting ${aggregator.delayMs}ms...`
    );
    await sleep(aggregator.delayMs);

    // Second read
    const rawEnd = await reader(dataSource, paramValues, state);
    const endValue = applyTransform(rawEnd, dataSource.transform);
    console.log(
      `[datasource-utils] Aggregator "${aggregator.id}" second read from "${dataSource.id}": ${endValue}`
    );

    // Compute deterministic metrics
    const delta = typeof endValue === 'number' && typeof startValue === 'number'
      ? endValue - startValue
      : 0;
    const pctChange = typeof startValue === 'number' && startValue !== 0
      ? (delta / startValue) * 100
      : 0;
    const direction = delta > 0 ? 'UP' : delta < 0 ? 'DOWN' : 'NO_MOVEMENT';

    return { startValue, endValue, direction, delta, pctChange };
  }

  throw new Error(`[datasource-utils] Unsupported aggregator type: "${aggregator.type}"`);
}

/**
 * Main entry point: Process instructions with data source resolution.
 *
 * Looks for "setFromDataSource" operations in stateDelta and replaces them
 * with "set" operations containing values read from the appropriate source.
 *
 * @param instructions - Instructions JSON string or object
 * @param dataSources - Map of data source ID → config
 * @param state - Current game state (for template resolution)
 * @param reader - Unified data source reader (dispatches to blockchain or HTTP)
 * @returns Instructions with setFromDataSource ops resolved to set ops
 */
export async function processDataSourceInstructions(
  instructions: string | object,
  dataSources: Record<string, DataSourceConfig>,
  state: any,
  reader: DataSourceReader
): Promise<string> {
  const instructionsObj =
    typeof instructions === 'string'
      ? JSON.parse(instructions)
      : { ...instructions };

  if (!instructionsObj.stateDelta || !Array.isArray(instructionsObj.stateDelta)) {
    return typeof instructions === 'string'
      ? instructions
      : JSON.stringify(instructionsObj);
  }

  instructionsObj.stateDelta = await processStateDeltaWithDataSources(
    instructionsObj.stateDelta,
    dataSources,
    state,
    reader
  );

  return JSON.stringify(instructionsObj);
}
