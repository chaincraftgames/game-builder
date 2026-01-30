/**
 * Schema Extraction Configuration
 *
 * Exports node configuration for schema extraction with planner-only pattern.
 * 
 * SIMPLIFIED APPROACH: We no longer convert the planner's custom format to JSON Schema
 * since state updates are deterministic (via stateDelta operations) and we never output
 * full state objects at runtime. The planner's lightweight format is sufficient for
 * field validation purposes.
 */

import {
  setupSpecSchemaModel,
} from "#chaincraft/ai/model-config.js";
import { schemaPlannerNode } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-schema/planner.js";
import {
  validatePlanCompleteness,
  validatePlanFieldCoverage,
  extractPlannerFields,
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

  // No executor needed - planner output is sufficient
  executor: undefined,

  maxAttempts: {
    plan: 1,
    execution: 0, // No execution phase
  },

  commit: async (store, state, threadId) => {
    if (!store) {
      throw new Error(
        "[schema_extraction_config] Store not configured - cannot commit data"
      );
    }

    // Retrieve planner output directly (no executor conversion)
    let plannerOutput;
    try {
      plannerOutput = await getFromStore(
        store,
        ["schema", "plan", "output"],
        threadId
      );
    } catch (error) {
      // Planner never ran or failed validation, return empty updates
      return {};
    }

    console.log("[commit] plannerOutput type:", typeof plannerOutput);
    console.log(
      "[commit] plannerOutput:",
      JSON.stringify(plannerOutput).substring(0, 200)
    );

    // Extract fields from planner output
    const fields = extractPlannerFields(plannerOutput);
    
    // Extract natural summary from planner output (handles both quoted and unquoted)
    let gameRules = "";
    // Try quoted format first: Natural summary: "..."
    let summaryMatch = plannerOutput.match(/Natural summary:\s*"([^"]+)"/i);
    if (summaryMatch) {
      gameRules = summaryMatch[1];
    } else {
      // Try unquoted format: Natural summary: text... (until Fields: or end)
      summaryMatch = plannerOutput.match(/Natural summary:\s*([^\n]+(?:\n(?!Fields:)[^\n]+)*)/i);
      if (summaryMatch) {
        gameRules = summaryMatch[1].trim();
      }
    }

    // Return partial state to be merged
    // stateSchema now stores the planner fields array instead of JSON Schema
    return {
      gameRules: gameRules,
      stateSchema: JSON.stringify(fields),
      exampleState: "", // No longer needed since we don't generate full state examples
    };
  },
};
