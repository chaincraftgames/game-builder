/**
 * Execute Changes Node
 * 
 * Formats planned changes as valid JSON matching the schema.
 * Uses structured output to ensure valid state format.
 */

import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { RuntimeStateType } from "../../runtime-state.js";
import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { deserializeSchema } from "#chaincraft/ai/simulate/schema.js";
import { executeChangesTemplate } from "./prompts.js";

export function executeChanges(model: ModelWithOptions) {
  return async (state: RuntimeStateType): Promise<Partial<RuntimeStateType>> => {
    console.debug("[execute_changes] Formatting changes as JSON");
    
    // Deserialize the schema to use for structured output
    const schema = deserializeSchema(state.stateSchema);
    
    const prompt = SystemMessagePromptTemplate.fromTemplate(executeChangesTemplate);
    
    const promptMessage = await prompt.format({
      plannedChanges: state.plannedChanges,
      gameState: state.gameState,
      stateSchema: state.stateSchema,
    });
    
    // Use structured output to ensure valid JSON
    const response = await model.invokeWithSystemPrompt(
      promptMessage.content as string,
      undefined,
      {
        agent: "execute-changes",
        workflow: "runtime",
      },
      schema
    );
    
    console.debug("[execute_changes] State execution complete");
    
    return {
      gameState: JSON.stringify(response),
      playerAction: undefined, // Clear processed action
    };
  };
}
