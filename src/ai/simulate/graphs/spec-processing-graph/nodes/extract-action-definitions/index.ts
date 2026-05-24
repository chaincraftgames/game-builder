/**
 * Action Definitions Extraction Configuration
 *
 * Single-pass extraction (no planner). Reads game spec and produces
 * ActionDefinitionsArtifact: a typed list of player action contracts.
 */

import { setupSpecSchemaModel } from "#chaincraft/ai/model-config.js";
import { actionDefinitionsExecutorNode } from "./executor.js";
import {
  getFromStore,
  NodeConfig,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/node-shared.js";
import {
  ActionDefinitionsArtifactSchema,
  type ActionDefinitionsArtifact,
} from "./schema.js";

export const actionDefinitionsExtractionConfig: NodeConfig = {
  namespace: "action-definitions",

  planner: undefined,

  executor: {
    node: actionDefinitionsExecutorNode,
    model: await setupSpecSchemaModel(),
    validators: [],
  },

  maxAttempts: {
    plan: 0,
    execution: 1,
  },

  commit: async (store, _state, threadId) => {
    if (!store) {
      throw new Error("[action_definitions_config] Store not configured");
    }

    let rawOutput: string;
    try {
      rawOutput = await getFromStore(
        store,
        ["action-definitions", "execution", "output"],
        threadId
      );
    } catch {
      return {};
    }

    // Strip markdown fences if present
    let jsonStr = rawOutput.trim();
    if (jsonStr.startsWith("```json")) jsonStr = jsonStr.slice(7);
    else if (jsonStr.startsWith("```")) jsonStr = jsonStr.slice(3);
    if (jsonStr.endsWith("```")) jsonStr = jsonStr.slice(0, jsonStr.length - 3);
    jsonStr = jsonStr.trim();

    let artifact: ActionDefinitionsArtifact;
    try {
      const parsed = JSON.parse(jsonStr);
      artifact = ActionDefinitionsArtifactSchema.parse(parsed);
    } catch (err) {
      console.error("[action_definitions_config] Failed to parse/validate artifact:", err);
      console.debug("[action_definitions_config] Raw output:", rawOutput.substring(0, 500));
      // Don't block the pipeline if action defs fail — return empty artifact
      artifact = {
        version: "1.0.0",
        generatedAt: new Date().toISOString(),
        actions: [],
      };
    }

    console.debug(
      `[action_definitions_config] Committed ${artifact.actions.length} action definition(s):`,
      artifact.actions.map(a => `${a.id}(${a.inputFields.map(f => f.name).join(", ")})`).join(", ")
    );

    return {
      actionDefinitions: JSON.stringify(artifact),
    };
  },
};
