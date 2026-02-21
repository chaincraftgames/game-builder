/**
 * Validation functions for produced tokens extraction
 */

import { SpecProcessingStateType } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/spec-processing-state.js";
import { getFromStore } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/node-shared.js";
import { extractSchemaFields } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/schema-utils.js";
import { BaseStore } from "@langchain/langgraph";
import { TokenSource } from "#chaincraft/ai/simulate/schema.js";

/**
 * Parse executor output to extract produced tokens configuration JSON
 */
export function extractProducedTokensConfig(executorOutput: string): any[] {
  try {
    // With structured output, the content should already be JSON
    const parsed = JSON.parse(executorOutput);
    // Extract tokens array from wrapper object
    if (parsed && typeof parsed === 'object' && 'tokens' in parsed && Array.isArray(parsed.tokens)) {
      return parsed.tokens;
    }
    return [];
  } catch (error) {
    console.warn("[validator] Failed to parse produced tokens configuration:", error);
    return [];
  }
}

/**
 * Get available fields from state schema by source type
 * Uses extractSchemaFields to get field paths, then filters by source and strips prefixes
 */
function getAvailableFields(stateSchema: string, source: TokenSource): Set<string> {
  const availableFields = new Set<string>();
  
  try {
    const schema = JSON.parse(stateSchema);
    const allFields = extractSchemaFields(schema);
    
    // Filter by source and strip prefix
    const prefix = source === TokenSource.Game ? "game." : "players.";
    
    for (const fieldPath of allFields) {
      if (fieldPath.startsWith(prefix)) {
        // Strip prefix to get bare field name
        const fieldName = fieldPath.substring(prefix.length);
        availableFields.add(fieldName);
      }
    }
  } catch (error) {
    console.warn("[validator] Failed to parse state schema:", error);
  }

  return availableFields;
}

/**
 * Validate produced tokens configuration fields exist in state schema
 */
export async function validateProducedTokensFields(
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string
): Promise<string[]> {
  const errors: string[] = [];
  
  const executorOutput = await getFromStore(store, ["producedTokens", "execution", "output"], threadId);
  
  if (!executorOutput) {
    errors.push("No executor output found");
    return errors;
  }

  // Extract produced tokens configuration
  const tokenConfigs = extractProducedTokensConfig(executorOutput);
  
  // If no tokens configured, that's valid (game might not need tokens)
  if (tokenConfigs.length === 0) {
    console.debug("[validator] No tokens configured - skipping field validation");
    return errors;
  }

  // Validate each token configuration
  for (const config of tokenConfigs) {
    if (!config || typeof config !== 'object') {
      errors.push(`Invalid token configuration: ${JSON.stringify(config)}`);
      continue;
    }

    const { tokenType, tokenSource, fields, description } = config as any;

    // Validate required properties
    if (!tokenType) {
      errors.push(`Token configuration missing tokenType`);
      continue;
    }

    if (!description) {
      errors.push(`Token type '${tokenType}' missing description`);
    }

    if (!tokenSource || !Object.values(TokenSource).includes(tokenSource)) {
      errors.push(`Token type '${tokenType}' has invalid or missing tokenSource (must be 'game' or 'player')`);
      continue;
    }

    if (!Array.isArray(fields) || fields.length === 0) {
      errors.push(`Token type '${tokenType}' has no fields specified`);
      continue;
    }

    // Get available fields for this source
    const availableFields = getAvailableFields(state.stateSchema, tokenSource);
    
    if (availableFields.size === 0) {
      errors.push(`No ${tokenSource} fields available in state schema for token type '${tokenType}'`);
      continue;
    }

    // Validate each field exists in schema
    for (const field of fields) {
      if (!availableFields.has(field)) {
        errors.push(
          `Token type '${tokenType}' references field '${field}' not found in ${tokenSource} state. ` +
          `Available fields: ${Array.from(availableFields).join(', ')}`
        );
      }
    }
  }
  
  return errors;
}
