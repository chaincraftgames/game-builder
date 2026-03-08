/**
 * HTTP Data Source Reader
 *
 * Reads data from keyless REST APIs (e.g., Binance) by building a URL
 * from the HttpDataSourceConfig, resolving template variables in query
 * params, and returning the parsed JSON response.
 *
 * No API keys are used — only free, keyless endpoints are supported.
 * This keeps the platform multi-tenant safe (no shared secrets).
 */

import type { HttpDataSourceConfig } from '../../../../../design/game-design-state.js';
import { resolveTemplateValue } from './datasource-utils.js';

/**
 * Read data from an HTTP API data source.
 *
 * @param config - The HTTP data source configuration
 * @param paramValues - Runtime parameter values (may contain {{template}} vars)
 * @param state - Current game state (for template resolution)
 * @returns The parsed JSON response body
 */
export async function readHttpDataSource(
  config: HttpDataSourceConfig,
  paramValues: Record<string, string>,
  state: any
): Promise<any> {
  const url = new URL(config.path, config.baseUrl);

  // Resolve query params — static values pass through, templates get resolved
  if (config.queryParams) {
    for (const [key, rawValue] of Object.entries(config.queryParams)) {
      // Check if param value should come from runtime paramValues
      const overrideValue = paramValues[key];
      const value = overrideValue
        ? resolveTemplateValue(overrideValue, state)
        : resolveTemplateValue(rawValue, state);
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(
      `[http-reader] HTTP ${response.status} from ${url.toString()}: ${response.statusText}`
    );
  }

  return response.json();
}
