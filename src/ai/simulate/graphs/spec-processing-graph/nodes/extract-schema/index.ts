/**
 * Schema Extraction Configuration
 *
 * Exports node configuration for schema extraction with planner/executor pattern
 */

import {
  setupSpecSchemaModel,
} from "#chaincraft/ai/model-config.js";
import { schemaPlannerNode } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-schema/planner.js";
import { schemaExecutorNode } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-schema/executor.js";
import {
  validatePlanCompleteness,
  validatePlanFieldCoverage,
  validateJsonParseable,
  validateSchemaStructure,
  validateRequiredFields,
  validateFieldTypes,
  validatePlannerFieldsInSchema,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-schema/validators.js";
import {
  getFromStore,
  NodeConfig,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/node-shared.js";

export const schemaExtractionConfig: NodeConfig = {
  namespace: "schema",

  planner: {
    node: schemaPlannerNode,
    model: await setupSpecSchemaModel(),
    validators: [validatePlanCompleteness, validatePlanFieldCoverage],
  },

  executor: {
    node: schemaExecutorNode,
    model: await setupSpecSchemaModel(),
    validators: [
      validateJsonParseable,
      validateSchemaStructure,
      validateRequiredFields,
      validateFieldTypes,
      validatePlannerFieldsInSchema,
    ],
  },

  maxAttempts: {
    plan: 1,
    execution: 1,
  },

  commit: async (store, state, threadId) => {
    if (!store) {
      throw new Error(
        "[schema_extraction_config] Store not configured - cannot commit data"
      );
    }

    // Retrieve execution output (getFromStore already unwraps .value)
    let executionOutput;
    try {
      executionOutput = await getFromStore(
        store,
        ["schema", "execution", "output"],
        threadId
      );
    } catch (error) {
      // Executor never ran (planner failed validation), return empty updates
      // Validation errors will be added by commit node
      return {};
    }

    console.log("[commit] executionOutput type:", typeof executionOutput);
    console.log(
      "[commit] executionOutput:",
      JSON.stringify(executionOutput).substring(0, 200)
    );

    const response =
      typeof executionOutput === "string"
        ? JSON.parse(executionOutput)
        : executionOutput;

    // Return partial state to be merged
    return {
      gameRules: response.gameRules,
      stateSchema: JSON.stringify(response.stateSchema),
      exampleState: JSON.stringify(response.state),
    };
  },
};
