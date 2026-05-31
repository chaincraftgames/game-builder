/**
 * Schema Extraction Configuration
 *
 * Exports node configuration for schema extraction with executor-only pattern.
 * 
 * SIMPLIFIED APPROACH: Direct extraction without planning phase. The executor
 * generates field definitions directly since state updates are deterministic
 * (via stateDelta operations) and we never output full state objects at runtime.
 */

import {
  setupSpecSchemaModel,
} from "#chaincraft/ai/model-config.js";
import { schemaExecutorNode } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-schema/executor.js";
import {
  validateExecutionCompleteness,
  validateExecutionFieldCoverage,
  extractExecutorFields,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-schema/validators.js";
import {
  getFromStore,
  NodeConfig,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/node-shared.js";
import { baseSchemaFields } from "#chaincraft/ai/simulate/schema.js";

export const schemaExtractionConfig: NodeConfig = {
  namespace: "schema",

  // No planning needed - direct extraction
  planner: undefined,

  executor: {
    node: schemaExecutorNode,
    model: await setupSpecSchemaModel(),
    validators: [validateExecutionCompleteness, validateExecutionFieldCoverage],
  },

  maxAttempts: {
    plan: 0, // No planning phase
    execution: 1,
  },

  commit: async (store, state, threadId) => {
    if (!store) {
      throw new Error(
        "[schema_extraction_config] Store not configured - cannot commit data"
      );
    }

    // Retrieve executor output directly
    let executorOutput;
    try {
      executorOutput = await getFromStore(
        store,
        ["schema", "execution", "output"],
        threadId
      );
    } catch (error) {
      // Executor never ran or failed validation, return empty updates
      return {};
    }

    console.log("[commit] executorOutput type:", typeof executorOutput);
    console.log(
      "[commit] executorOutput:",
      JSON.stringify(executorOutput).substring(0, 200)
    );

    // Extract fields from executor output
    const customFields = extractExecutorFields(executorOutput);
    
    // Merge base schema fields with custom fields
    const allFields = [...baseSchemaFields, ...customFields];
    
    // gameRules is used by the repair agent and sim assistant as lightweight context.
    // Elimination strategy: remove schema field blocks/code fences and keep the remaining prose.
    const summaryByElimination = executorOutput
      .replace(/Fields:\s*```[\s\S]*?```/gi, "")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/Natural summary:\s*/i, "")
      .replace(/^#+\s.*$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // Keep context compact to avoid flooding downstream prompts.
    const gameRules = (summaryByElimination || executorOutput.trim()).slice(0, 1200);

    // Return partial state to be merged
    // stateSchema stores the field definitions array in condensed format
    return {
      gameRules: gameRules,
      stateSchema: JSON.stringify(allFields),
      exampleState: "", // No longer needed since we don't generate full state examples
    };
  },
};
