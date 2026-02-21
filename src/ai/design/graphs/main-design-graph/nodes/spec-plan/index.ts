/**
 * Spec Planning Node
 * 
 * Generates a structured plan with metadata and changes for the game specification.
 * Extracts summary, playerCount, and detailed change plan from conversation.
 */

import { BaseMessage, HumanMessage } from "@langchain/core/messages";
import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { GameDesignState, getConsolidationThresholds } from "#chaincraft/ai/design/game-design-state.js";
import { GameDesignSpecification, SpecPlanSchema } from "#chaincraft/ai/design/schemas.js";
import { getSpecPlanPrompt } from "./prompts.js";

/**
 * Extracts messages that are relevant for planning spec updates.
 * Returns all messages since the last spec was generated, or all messages
 * if this is the first spec generation.
 * 
 * @param state - Current graph state
 * @returns Array of messages to use for planning
 */
function extractRelevantMessages(
  state: typeof GameDesignState.State
): BaseMessage[] {
  const { messages, lastSpecMessageCount } = state;
  
  // First spec generation - use all messages
  if (lastSpecMessageCount === undefined) {
    return messages;
  }
  
  // Subsequent updates - only messages after last spec generation
  return messages.slice(lastSpecMessageCount);
}

/**
 * Formats conversation messages as text for inclusion in the prompt.
 * This makes it clear to the LLM that it's analyzing a conversation between
 * the user and another agent, not participating in the conversation itself.
 * 
 * @param messages - Array of messages to format
 * @returns Formatted conversation text
 */
function formatConversationHistory(messages: BaseMessage[]): string {
  return messages.map(msg => {
    const role = msg instanceof HumanMessage ? 'User' : 'Design Assistant';
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
  currentSpec?: GameDesignSpecification
): string {
  if (!currentSpec) {
    return "**Current Specification:** None (this is the first specification)";
  }
  
  return `**Current Specification:**

Summary: ${currentSpec.summary}
Player Count: ${currentSpec.playerCount.min}-${currentSpec.playerCount.max} players

${currentSpec.designSpecification}`;
}

/**
 * Formats conversation context for the prompt.
 * 
 * @param messageCount - Number of messages being considered
 * @param isFirstSpec - Whether this is the first spec generation
 * @returns Formatted string for prompt variable replacement
 */
function formatConversationSummary(
  messageCount: number,
  isFirstSpec: boolean
): string {
  if (isFirstSpec) {
    return `**Conversation Between User and Design Assistant:**

The ${messageCount} message(s) below represent the initial conversation where the user describes their game idea.`;
  }
  
  return `**Conversation Between User and Design Assistant:**

The ${messageCount} message(s) below represent the conversation since the last specification was generated.`;
}

/**
 * Creates the spec planning function.
 * 
 * @param model - LLM model for generating plans
 * @returns Async function that processes state and returns updates
 */
export function createSpecPlan(model: ModelWithOptions) {
  // Create structured output parser using central schema
  const parser = StructuredOutputParser.fromZodSchema(SpecPlanSchema);
  
  return async (state: typeof GameDesignState.State) => {
    // 1. Extract relevant messages (conversation since last spec update)
    const relevantMessages = extractRelevantMessages(state);
    
    if (relevantMessages.length === 0) {
      throw new Error(
        "[spec-plan] No messages to process. This should not happen - " +
        "spec_update_needed should only be true when there are new messages."
      );
    }
    
    // 2. Determine if this is initial generation
    const isInitialGeneration = !state.currentSpec;
    
    // 3. Get appropriate prompt for initial vs iterative generation
    const systemPromptTemplate = getSpecPlanPrompt(isInitialGeneration);
    const systemTemplate = SystemMessagePromptTemplate.fromTemplate(systemPromptTemplate);
    
    // 4. Format the conversation as text
    const conversationHistory = formatConversationHistory(relevantMessages);
    
    // 5. Prepare template variables
    const currentSpec = formatCurrentSpec(state.currentSpec);
    const conversationSummary = formatConversationSummary(
      relevantMessages.length,
      isInitialGeneration
    );
    const formatInstructions = parser.getFormatInstructions();
    
    // 6. Format system prompt using template
    const systemMessage = await systemTemplate.format({
      currentSpec,
      conversationSummary,
      conversationHistory,
      format_instructions: formatInstructions,
    });
    
    // 5. Call LLM with formatted system prompt
    const response = await model.invokeWithSystemPrompt(
      systemMessage.content as string,
      undefined, // No user prompt needed
      {
        agent: "spec-planning-agent",
        workflow: "design"
      }
    );
    
    const responseText = response.content as string;
    
    // 6. Strip markdown code fences if present
    let cleanedResponse = responseText.trim();
    if (cleanedResponse.startsWith('```')) {
      cleanedResponse = cleanedResponse.replace(/^```(?:json)?\s*\n?/, '');
      cleanedResponse = cleanedResponse.replace(/\n?```\s*$/, '');
    }
    
    // 7. Parse the structured output
    const specPlan = await parser.parse(cleanedResponse);
    
    // 8. Prepare state updates
    const updates: any = {
      specPlan,
      pendingSpecChanges: [specPlan],
      specDiff: undefined, // Clear old diff since we're accumulating, not generating
    };
    
    // Only update narrativeStyleGuidance if it was provided in the plan
    if (specPlan.narrativeStyleGuidance) {
      updates.narrativeStyleGuidance = specPlan.narrativeStyleGuidance;
    }
    
    // If narrativeChanges are specified, add those keys to narrativesNeedingUpdate
    if (specPlan.narrativeChanges && specPlan.narrativeChanges.length > 0) {
      updates.narrativesNeedingUpdate = specPlan.narrativeChanges.map(nc => nc.key);
    }
    
    return updates;
  };
}

/**
 * Standalone version for testing without model dependency.
 * TODO: Remove once we have proper testing infrastructure.
 */
export async function specPlan(state: typeof GameDesignState.State) {
  throw new Error("Spec plan not yet implemented - use createSpecPlan with a model");
}
