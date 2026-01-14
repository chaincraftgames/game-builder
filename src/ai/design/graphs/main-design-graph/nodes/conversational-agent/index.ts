/**
 * Conversational Design Agent Node
 * 
 * Handles natural language conversation with the user about game design.
 * Sets flags for routing to spec or metadata updates.
 */
import { AIMessage } from "@langchain/core/messages";
import { ModelWithOptions } from "#chaincraft/ai/model-config.js"
import { GameDesignState } from "#chaincraft/ai/design/game-design-state.js";
import { createCachedSystemMessage } from "#chaincraft/ai/prompt-template-processor.js";
import { 
  SYSTEM_PROMPT, 
  formatFewShotExamples,
  SPEC_UPDATE_TAG,
  METADATA_UPDATE_TAG,
  GAME_TITLE_TAG
} from "./prompts.js";

/**
 * Extracts game title from response with <game_title> tags.
 */
export function extractGameTitle(response: string): string | undefined {
  const match = response.match(/<game_title>(.*?)<\/game_title>/s);
  return match ? match[1].trim() : undefined;
}

/**
 * Checks if a tag is present in the response.
 */
export function hasTag(response: string, tag: string): boolean {
  return response.includes(tag);
}

/**
 * Removes all internal tags from the response before showing to user.
 */
export function stripInternalTags(response: string): string {
  return response
    .replace(/<game_title>.*?<\/game_title>/gs, '')
    .replace(/<spec_update_needed>/g, '')
    .replace(/<metadata_update_needed>/g, '')
    .trim();
}

/**
 * Creates the conversational design agent.
 * 
 * @param constraintsRegistry - Game design constraints and requirements
 * @param mechanicsRegistry - Available game mechanics
 * @returns Async function that processes state and returns updates
 */
export async function createConversationalAgent(
  model: ModelWithOptions,
  constraintsRegistry: string,
  mechanicsRegistry: string
) {
  return async (state: typeof GameDesignState.State) => {
    // 1. Get available narrative keys from state.specNarratives
    const narrativeMarkers = Object.keys(state.specNarratives || {});
    const narrativeContext = narrativeMarkers.length > 0
      ? `\nAvailable narrative sections for this game:\n${narrativeMarkers.map(m => `- ${m}`).join('\n')}`
      : '';
    
    // 2. Create cached system message with variable substitution
    const systemMessage = createCachedSystemMessage(SYSTEM_PROMPT, {
      mechanicsRegistry,
      constraintsRegistry,
      fewShotExamples: formatFewShotExamples(),
      narrativeContext
    });
    
    // 3. Build message history with cached system message
    const messages = [
      systemMessage,
      ...state.messages
    ];
    
    // 4. Call LLM with full message history
    const response = await model.invokeWithMessages(messages, {
      agent: "conversational-design-agent",
      workflow: "design"
    });
    const responseText = response.content as string;
    
    // 5. Parse response for tags
    const gameTitle = extractGameTitle(responseText);
    const specUpdateNeeded = hasTag(responseText, SPEC_UPDATE_TAG);
    const metadataUpdateNeeded = hasTag(responseText, METADATA_UPDATE_TAG);
    
    // 6. Strip internal tags for user-facing message
    const userMessage = stripInternalTags(responseText);
    
    // 7. Return state updates
    return {
      messages: [new AIMessage(userMessage)],
      title: gameTitle,
      specUpdateNeeded: specUpdateNeeded,
      metadataUpdateNeeded: metadataUpdateNeeded
    };
  };
}

