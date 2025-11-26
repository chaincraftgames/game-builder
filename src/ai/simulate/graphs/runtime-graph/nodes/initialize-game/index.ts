/**
 * Initialize Game Node
 *
 * Sets up initial game state when players join.
 * Uses schema and instructions to create valid initial state.
 */

import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { RuntimeStateType } from "../../runtime-state.js";
import { deserializeSchema } from "#chaincraft/ai/simulate/schema.js";
import { runtimeInitializeTemplate } from "./prompts.js";

export function initializeGame(model: ModelWithOptions) {
  return async (state: RuntimeStateType): Promise<Partial<RuntimeStateType>> => {
    console.debug("[initialize_game] Initializing game state for players:", state.players);

    const setupInstructions =
      state.phaseInstructions?.setup ||
      state.phaseInstructions?.Setup ||
      state.phaseInstructions?.SETUP ||
      "Initialize game state with starting values for all fields in the schema.";

    console.debug("[initialize_game] Using setup instructions:",
      (setupInstructions || "").toString().substring(0, 200) + "...");

    // Deserialize the schema for structured output
    const schema = deserializeSchema(state.stateSchema);

    // Create prompt template
    const prompt = SystemMessagePromptTemplate.fromTemplate(runtimeInitializeTemplate);

    const promptMessage = await prompt.format({
      gameRules: state.gameRules,
      players: JSON.stringify(state.players || {}),
      setupInstructions,
    });

    // Use structured output to ensure valid JSON
    const response = await model.invokeWithSystemPrompt(
      promptMessage.content as string,
      undefined,
      {
        agent: "initialize-game",
        workflow: "runtime",
      },
      schema
    );

    console.debug("[initialize_game] AI response:", response);

    // Extract current phase from response
    const gameState = response as any;
    const currentPhase = gameState.game?.phase || "setup";

    // requiresPlayerInput will be determined by route-phase AI based on state transitions
    const requiresPlayerInput = true; // Default to true (safer - wait for routing decision)

    return {
      gameState: JSON.stringify(response),
      isInitialized: true,
      currentPhase,
      requiresPlayerInput,
    };
  };
}
