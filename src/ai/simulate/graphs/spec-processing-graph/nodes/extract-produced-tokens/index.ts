/**
 * Produced Tokens Extraction Configuration
 *
 * Exports node configuration for produced tokens extraction with executor-only pattern.
 * 
 * Analyzes game specification to determine which tokens this game produces
 * and which fields should be included in those tokens.
 */

import {
  setupSpecSchemaModel,
} from "#chaincraft/ai/model-config.js";
import { producedTokensExecutorNode } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-produced-tokens/executor.js";
import {
  validateProducedTokensFields,
  extractProducedTokensConfig,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-produced-tokens/validators.js";
import {
  getFromStore,
  NodeConfig,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/node-shared.js";

export const producedTokensExtractionConfig: NodeConfig = {
  namespace: "producedTokens",

  // No planning needed - direct extraction
  planner: undefined,

  executor: {
    node: producedTokensExecutorNode,
    model: await setupSpecSchemaModel(),
    validators: [validateProducedTokensFields], // Structure validated by Zod schema
  },

  maxAttempts: {
    plan: 0, // No planning phase
    execution: 1,
  },

  commit: async (store, state, threadId) => {
    if (!store) {
      throw new Error(
        "[produced_tokens_extraction_config] Store not configured - cannot commit data"
      );
    }

    // Retrieve executor output
    let executorOutput;
    try {
      executorOutput = await getFromStore(
        store,
        ["producedTokens", "execution", "output"],
        threadId
      );
    } catch (error) {
      // Executor never ran or failed validation, return empty configuration
      return {
        producedTokensConfiguration: JSON.stringify({ tokens: [] }),
      };
    }

    // Executor output is already the full artifact with tokens array
    // Just validate it parses correctly
    try {
      JSON.parse(executorOutput);
    } catch (error) {
      console.warn("[commit] Failed to parse executor output, returning empty config");
      return {
        producedTokensConfiguration: JSON.stringify({ tokens: [] }),
      };
    }
    
    // Return the full artifact as-is
    return {
      producedTokensConfiguration: executorOutput,
    };
  },
};
