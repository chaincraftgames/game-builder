/**
 * Plan Metadata Node
 * 
 * Generates a natural language plan for gamepiece metadata extraction.
 * Analyzes the game specification and recent conversation to identify
 * all physical game components that need metadata extraction.
 */

import { BaseMessage } from "@langchain/core/messages";
import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { GameDesignState, MetadataPlan } from "#chaincraft/ai/design/game-design-state.js";
import { MetadataPlanSchema } from "#chaincraft/ai/design/schemas.js";
import { SYSTEM_PROMPT } from "./prompts.js";

/**
 * Extracts messages that are relevant for metadata planning.
 * Returns all messages since the last metadata update, or all messages
 * if this is the first metadata extraction.
 * 
 * @param state - Current graph state
 * @returns Array of messages to use for planning
 */
function extractRelevantMessages(
  state: typeof GameDesignState.State
): BaseMessage[] {
  const { messages, lastMetadataUpdate } = state;
  
  // First metadata extraction - use all messages
  if (lastMetadataUpdate === undefined) {
    return messages;
  }
  
  // Subsequent updates - use all messages (metadata updates are less frequent)
  // TODO: Filter by timestamp once we track message timestamps
  return messages;
}

/**
 * Formats conversation messages as text for inclusion in the prompt.
 * 
 * @param messages - Array of messages to format
 * @returns Formatted conversation text
 */
function formatConversationHistory(messages: BaseMessage[]): string {
  return messages.map(msg => {
    const role = msg._getType() === 'human' ? 'User' : 'Design Assistant';
    return `${role}: ${msg.content}`;
  }).join('\n\n');
}

/**
 * Formats the current spec for inclusion in the LLM prompt.
 * 
 * @param currentSpec - Current game specification, if it exists
 * @returns Formatted string for prompt variable replacement
 */
function formatCurrentSpec(
  currentSpec: typeof GameDesignState.State.currentGameSpec
): string {
  if (!currentSpec) {
    return "**Current Specification:** None";
  }
  
  return `**Current Specification:**

Summary: ${currentSpec.summary}
Player Count: ${currentSpec.playerCount.min}-${currentSpec.playerCount.max} players

${currentSpec.designSpecification}`;
}

/**
 * Formats the current metadata for inclusion in the LLM prompt.
 * 
 * @param metadata - Current gamepiece metadata, if it exists
 * @returns Formatted string for prompt variable replacement
 */
function formatCurrentMetadata(
  metadata: typeof GameDesignState.State.metadata
): string {
  if (!metadata || (!metadata.gamepieceTypes?.length && !metadata.gamepieceInstances?.length)) {
    return "**Current Metadata:** None (this is the first metadata extraction)";
  }
  
  let formatted = "**Current Metadata:**\n\n";
  
  if (metadata.gamepieceTypes?.length) {
    formatted += `Types (${metadata.gamepieceTypes.length}):\n`;
    metadata.gamepieceTypes.forEach((type: any) => {
      formatted += `- ${type.name} (id: ${type.id}, type: ${type.type}, quantity: ${type.quantity || 'N/A'})\n`;
    });
    formatted += '\n';
  }
  
  if (metadata.gamepieceInstances?.length) {
    formatted += `Instances (${metadata.gamepieceInstances.length}):\n`;
    metadata.gamepieceInstances.forEach((instance: any) => {
      formatted += `- ${instance.name} (id: ${instance.id}, type_id: ${instance.type_id})\n`;
    });
  }
  
  return formatted.trim();
}

/**
 * Formats conversation context for the prompt.
 * 
 * @param messageCount - Number of messages being considered
 * @param isFirstExtraction - Whether this is the first metadata extraction
 * @returns Formatted string for prompt variable replacement
 */
function formatConversationSummary(
  messageCount: number,
  isFirstExtraction: boolean
): string {
  if (isFirstExtraction) {
    return `**Conversation Between User and Design Assistant:**

The ${messageCount} message(s) below represent the conversation where the user describes their game.`;
  }
  
  return `**Conversation Between User and Design Assistant:**

The ${messageCount} message(s) below represent the recent conversation where the user may have mentioned new gamepieces or changes.`;
}

/**
 * Creates the metadata planning function.
 * 
 * @param model - LLM model for generating plans
 * @returns Async function that processes state and returns updates
 */
export function createPlanMetadata(model: ModelWithOptions) {
  // Create system prompt template
  const systemTemplate = SystemMessagePromptTemplate.fromTemplate(SYSTEM_PROMPT);
  
  return async (state: typeof GameDesignState.State) => {
    // 1. Extract relevant messages
    const relevantMessages = extractRelevantMessages(state);
    
    if (relevantMessages.length === 0) {
      throw new Error(
        "[plan-metadata] No messages to process. This should not happen."
      );
    }
    
    // 2. Format the conversation as text
    const conversationHistory = formatConversationHistory(relevantMessages);
    
    // 3. Prepare template variables
    const currentSpec = formatCurrentSpec(state.currentGameSpec);
    const currentMetadata = formatCurrentMetadata(state.metadata);
    const conversationSummary = formatConversationSummary(
      relevantMessages.length,
      !state.metadata
    );
    
    // 4. Format system prompt using template
    const systemMessage = await systemTemplate.format({
      currentSpec,
      currentMetadata,
      conversationSummary,
      conversationHistory,
    });
    
    // 5. Call LLM with formatted system prompt using structured output
    const metadataPlan = await model.invokeWithSystemPrompt(
      systemMessage.content as string,
      undefined, // No user prompt needed
      {
        agent: "metadata-planning-agent",
        workflow: "design"
      },
      MetadataPlanSchema // Request structured output
    ) as MetadataPlan;
    
    // 6. Return state update with both structured plan and legacy string field
    return {
      metadataPlan,
      metadataChangePlan: metadataPlan.metadataChangePlan, // For backward compatibility
    };
  };
}

/**
 * Standalone version for testing without model dependency.
 * Uses spec-plan model as a reasonable default.
 */
export async function planMetadata(state: typeof GameDesignState.State) {
  const { setupSpecPlanModel } = await import("#chaincraft/ai/model-config.js");
  const model = await setupSpecPlanModel();
  const planMetadataFn = createPlanMetadata(model);
  return planMetadataFn(state);
}
