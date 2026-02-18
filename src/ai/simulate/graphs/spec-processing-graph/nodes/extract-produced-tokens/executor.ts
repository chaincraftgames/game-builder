/**
 * Produced Tokens Executor Node
 * 
 * Analyzes game specification to determine which tokens this game produces
 */

import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { SpecProcessingStateType } from "../../spec-processing-state.js";
import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { extractProducedTokensTemplate } from "./prompts.js";
import { ProducedTokensArtifactSchema, ProducedTokensArtifactSchemaJson } from "#chaincraft/ai/simulate/schema.js";
import {
  GraphConfigWithStore,
  incrementAttemptCount,
  putToStore,
} from "../../node-shared.js";

/**
 * Format state fields for prompt
 */
function formatStateFields(stateSchemaJson: string): string {
  if (!stateSchemaJson) {
    return "No state fields available";
  }

  try {
    const fields = JSON.parse(stateSchemaJson);
    if (!Array.isArray(fields)) {
      return "Invalid state schema format";
    }

    const gameFields = fields
      .filter((f: any) => f.path === "game")
      .map((f: any) => `  - ${f.name} (${f.type}): ${f.purpose || ""}`)
      .join("\n");

    const playerFields = fields
      .filter((f: any) => f.path === "player")
      .map((f: any) => `  - ${f.name} (${f.type}): ${f.purpose || ""}`)
      .join("\n");

    return `Game State Fields:\n${gameFields || "  (none)"}\n\nPlayer State Fields:\n${playerFields || "  (none)"}`;
  } catch (error) {
    return "Error parsing state schema";
  }
}

export function producedTokensExecutorNode(model: ModelWithOptions) {
  return async (
    state: SpecProcessingStateType,
    config?: GraphConfigWithStore
  ): Promise<Partial<SpecProcessingStateType>> => {
    console.debug("[produced_tokens_executor] Analyzing specification for produced tokens");

    const store = config?.store;
    const threadId = config?.configurable?.thread_id || "default";

    // Format state fields from schema
    const stateFields = formatStateFields(state.stateSchema);

    // Generate produced tokens extraction
    const executorPrompt = SystemMessagePromptTemplate.fromTemplate(extractProducedTokensTemplate);
    const executorSystemMessage = await executorPrompt.format({
      gameSpecification: state.gameSpecification,
      stateFields,
      outputSchema: JSON.stringify(ProducedTokensArtifactSchemaJson, null, 2),
    });

    const executorOutput = await model.invokeWithSystemPrompt(
      executorSystemMessage.content as string,
      undefined,
      {
        agent: "produced-tokens-executor",
        workflow: "spec-processing",
      },
      ProducedTokensArtifactSchema
    );

    console.debug("[produced_tokens_executor] Extraction complete");

    // Store raw output in store (not checkpointed)
    // With structured output, executorOutput is the parsed object directly
    const contentString = JSON.stringify(executorOutput);
    
    await putToStore(store, ["producedTokens", "execution", "output"], threadId, contentString);

    // Track attempt count in store
    await incrementAttemptCount(store, "producedTokens", "execution", threadId);

    return {};
  };
}
