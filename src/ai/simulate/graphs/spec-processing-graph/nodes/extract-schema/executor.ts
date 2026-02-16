/**
 * Schema Executor Node
 * 
 * Analyzes game specification and identifies required state fields
 */

import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { SpecProcessingStateType } from "../../spec-processing-state.js";
import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { planSchemaTemplate } from "./prompts.js";
import { baseGameStateSchemaJson, baseSchemaFieldsJson } from "#chaincraft/ai/simulate/schema.js";
import {
  GraphConfigWithStore,
  incrementAttemptCount,
  putToStore,
} from "../../node-shared.js";

export function schemaExecutorNode(model: ModelWithOptions) {
  return async (
    state: SpecProcessingStateType,
    config?: GraphConfigWithStore
  ): Promise<Partial<SpecProcessingStateType>> => {
    console.debug("[schema_executor] Analyzing specification for state structure");

    const store = config?.store;
    const threadId = config?.configurable?.thread_id || "default";

    // Generate schema extraction
    const executorPrompt = SystemMessagePromptTemplate.fromTemplate(planSchemaTemplate);
    const executorSystemMessage = await executorPrompt.format({
      gameSpecification: state.gameSpecification,
      schema: baseGameStateSchemaJson,
      baseSchemaFields: baseSchemaFieldsJson,
    });

    const executorOutput = await model.invokeWithSystemPrompt(
      executorSystemMessage.content as string,
      undefined,
      {
        agent: "schema-executor",
        workflow: "spec-processing",
      }
    );

    console.debug("[schema_executor] Extraction complete");

    // Store raw output in store (not checkpointed)
    // Convert content to string for validator processing
    const contentString = typeof executorOutput.content === 'string' 
      ? executorOutput.content 
      : JSON.stringify(executorOutput.content);
    
    await putToStore(store, ["schema", "execution", "output"], threadId, contentString);

    // Track attempt count in store
    await incrementAttemptCount(store, "schema", "execution", threadId);

    return {};
  };
}
