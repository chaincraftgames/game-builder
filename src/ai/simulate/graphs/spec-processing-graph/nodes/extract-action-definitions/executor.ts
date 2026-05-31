/**
 * Action Definitions Executor Node
 *
 * Analyzes game specification and identifies all player action types
 * along with the input data each action requires from the player.
 */

import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { SpecProcessingStateType } from "../../spec-processing-state.js";
import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { executeActionDefinitionsTemplate } from "./prompts.js";
import { ActionDefinitionsArtifactSchemaJson } from "./schema.js";
import {
  GraphConfigWithStore,
  incrementAttemptCount,
  putToStore,
} from "../../node-shared.js";

export function actionDefinitionsExecutorNode(model: ModelWithOptions) {
  return async (
    state: SpecProcessingStateType,
    config?: GraphConfigWithStore
  ): Promise<Partial<SpecProcessingStateType>> => {
    console.debug("[action_definitions_executor] Extracting player action definitions from spec");

    const store = config?.store;
    const threadId = config?.configurable?.thread_id || "default";

    const prompt = SystemMessagePromptTemplate.fromTemplate(executeActionDefinitionsTemplate);
    const systemMessage = await prompt.format({
      gameSpecification: state.gameSpecification,
      schemaJson: JSON.stringify(ActionDefinitionsArtifactSchemaJson, null, 2),
    });

    const output = await model.invokeWithSystemPrompt(
      systemMessage.content as string,
      undefined,
      {
        agent: "action-definitions-executor",
        workflow: "spec-processing",
      }
    );

    const contentString = typeof output.content === "string"
      ? output.content
      : JSON.stringify(output.content);

    await putToStore(store, ["action-definitions", "execution", "output"], threadId, contentString);
    await incrementAttemptCount(store, "action-definitions", "execution", threadId);

    return {};
  };
}
