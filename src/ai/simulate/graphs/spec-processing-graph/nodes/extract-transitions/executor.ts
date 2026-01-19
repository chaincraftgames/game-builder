/**
 * Transitions Executor Node
 *
 * Generates formal transitions artifact from planner analysis
 */

import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { SpecProcessingStateType } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/spec-processing-state.js";
import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { executeTransitionsTemplate } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-transitions/prompts.js";
import {
  TransitionsArtifactSchema,
  TransitionsArtifactSchemaJson,
} from "#chaincraft/ai/simulate/schema.js";
import { JsonLogicSchemaJson } from "#chaincraft/ai/simulate/logic/jsonlogic.js";
import {
  getFromStore,
  GraphConfigWithStore,
  incrementAttemptCount,
  putToStore,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/node-shared.js";
import {
  extractFieldsFromJsonSchema,
  formatFieldsListForPrompt,
  formatComputedContextForPrompt,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-transitions/utils.js";

export function transitionsExecutorNode(model: ModelWithOptions) {
  return async (
    state: SpecProcessingStateType,
    config?: GraphConfigWithStore
  ): Promise<Partial<SpecProcessingStateType>> => {
    console.debug(
      "[transitions_executor] Generating formal transitions structure"
    );

    const store = config?.store;
    const threadId = config?.configurable?.thread_id || "default";

    // Retrieve planner output from store
    let plannerOutput: string;
    if (store) {
      plannerOutput = await getFromStore(
        store,
        ["transitions", "plan", "output"],
        threadId
      );
    } else {
      throw new Error(
        "[transitions_executor] Store not configured - cannot retrieve planner output"
      );
    }

    if (!plannerOutput) {
      throw new Error(
        "[transitions_executor] No planner output found in store"
      );
    }

    // Extract fields from schema for explicit field list
    const availableFields = extractFieldsFromJsonSchema(
      String(state.stateSchema ?? "{}")
    );
    const fieldsListForPrompt = formatFieldsListForPrompt(availableFields);
    const computedContextForPrompt = formatComputedContextForPrompt();

    // Generate transitions from plan
    const executorPrompt = SystemMessagePromptTemplate.fromTemplate(
      executeTransitionsTemplate
    );
    const executorSystemMessage = await executorPrompt.format({
      transitionsPlan: String(plannerOutput ?? ""),
      availableFields: fieldsListForPrompt,
      computedContextFields: computedContextForPrompt,
      jsonLogicSchema: JsonLogicSchemaJson,
      transitionsArtifactSchema: TransitionsArtifactSchemaJson,
    });

    const response = await model.invokeWithSystemPrompt(
      executorSystemMessage.content as string,
      undefined,
      {
        agent: "transitions-executor",
        workflow: "spec-processing",
      },
      TransitionsArtifactSchema
    );

    console.debug("[transitions_executor] Transitions generation complete");

    // Store raw execution output in store (not checkpointed)
    await putToStore(
      store,
      ["transitions", "execution", "output"],
      threadId,
      JSON.stringify(response)
    );

    // Track attempt count in store
    await incrementAttemptCount(store, "transitions", "execution", threadId);

    return {};
  };
}
