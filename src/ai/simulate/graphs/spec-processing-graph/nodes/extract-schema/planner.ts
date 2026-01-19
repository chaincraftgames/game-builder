/**
 * Schema Planner Node
 * 
 * Analyzes game specification and identifies required state fields
 */

import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { SpecProcessingStateType } from "../../spec-processing-state.js";
import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { planSchemaTemplate } from "./prompts.js";
import { baseGameStateSchemaJson } from "#chaincraft/ai/simulate/schema.js";
import {
  GraphConfigWithStore,
  incrementAttemptCount,
  putToStore,
} from "../../node-shared.js";

export function schemaPlannerNode(model: ModelWithOptions) {
  return async (
    state: SpecProcessingStateType,
    config?: GraphConfigWithStore
  ): Promise<Partial<SpecProcessingStateType>> => {
    console.debug("[schema_planner] Analyzing specification for state structure");

    const store = config?.store;
    const threadId = config?.configurable?.thread_id || "default";

    // Generate planner analysis
    const plannerPrompt = SystemMessagePromptTemplate.fromTemplate(planSchemaTemplate);
    const plannerSystemMessage = await plannerPrompt.format({
      gameSpecification: state.gameSpecification,
      schema: baseGameStateSchemaJson,
    });

    const plannerAnalysis = await model.invokeWithSystemPrompt(
      plannerSystemMessage.content as string,
      undefined,
      {
        agent: "schema-planner",
        workflow: "spec-processing",
      }
    );

    console.debug("[schema_planner] Analysis complete");

    // Store raw output in store (not checkpointed)
    // Convert content to string for validator processing
    const contentString = typeof plannerAnalysis.content === 'string' 
      ? plannerAnalysis.content 
      : JSON.stringify(plannerAnalysis.content);
    
    await putToStore(store, ["schema", "plan", "output"], threadId, contentString);

    // Track attempt count in store
    await incrementAttemptCount(store, "schema", "plan", threadId);

    return {};
  };
}
