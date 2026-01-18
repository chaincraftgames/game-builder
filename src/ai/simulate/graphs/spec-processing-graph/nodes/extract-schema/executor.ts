/**
 * Schema Executor Node
 *
 * Generates formal schema structure from planner analysis
 */

import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { SpecProcessingStateType } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/spec-processing-state.js";
import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { executeSchemaTemplate } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-schema/prompts.js";
import { baseGameStateSchemaJson } from "#chaincraft/ai/simulate/schema.js";
import { extractSchemaResponseSchema } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-schema/schema.js";
import { z } from "zod";
import {
  getFromStore,
  GraphConfigWithStore,
  incrementAttemptCount,
  putToStore,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/node-shared.js";

export function schemaExecutorNode(model: ModelWithOptions) {
  return async (
    state: SpecProcessingStateType,
    config?: GraphConfigWithStore
  ): Promise<Partial<SpecProcessingStateType>> => {
    console.debug("[schema_executor] Generating formal schema structure");

    const store = config?.store;
    const threadId = config?.configurable?.thread_id || "default";

    // Retrieve planner output from store
    let plannerOutput: string;
    if (store) {
      plannerOutput = await getFromStore(
        store,
        ["schema", "plan", "output"],
        threadId
      );
    } else {
      throw new Error(
        "[schema_executor] Store not configured - cannot retrieve planner output"
      );
    }

    if (!plannerOutput) {
      throw new Error("[schema_executor] No planner output found in store");
    }

    // Generate schema from plan
    const executorPrompt = SystemMessagePromptTemplate.fromTemplate(
      executeSchemaTemplate
    );
    const executorSystemMessage = await executorPrompt.format({
      plannerAnalysis: plannerOutput,
      schema: baseGameStateSchemaJson,
    });

    const response = (await model.invokeWithSystemPrompt(
      executorSystemMessage.content as string,
      undefined,
      {
        agent: "schema-executor",
        workflow: "spec-processing",
      },
      extractSchemaResponseSchema
    )) as z.infer<typeof extractSchemaResponseSchema>;

    console.debug("[schema_executor] Schema generation complete");

    // Store raw execution output in store (not checkpointed)
    await putToStore(store, ["schema", "execution", "output"], threadId, JSON.stringify(response));

    // Track attempt count in state
    await incrementAttemptCount(store, "schema", "execution", threadId);

    return {};
  };
}
