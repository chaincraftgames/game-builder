/**
 * Generate Narratives Node
 * 
 * Generates narrative content for a single marker in the skeleton specification.
 * Invoked in parallel via LangGraph Send — one instance per marker key.
 * Results merge into specNarratives via a merge-object reducer.
 */

import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import type { GameDesignState } from "#chaincraft/ai/design/game-design-state.js";
import { createCachedSystemMessage } from "#chaincraft/ai/prompt-template-processor.js";
import { HumanMessage } from "@langchain/core/messages";
import { SYSTEM_PROMPT } from "./prompts.js";

/**
 * Creates the single-narrative generation function.
 * Each invocation handles exactly one marker key, provided via Send payload.
 * 
 * @param model - LLM model for generating narrative content
 * @returns Async function that processes state and returns updates
 */
export function createGenerateNarratives(model: ModelWithOptions) {
  return async (state: typeof GameDesignState.State) => {
    // The marker key to generate is the sole entry in narrativesNeedingUpdate,
    // set by the Send payload from routeFromSpecExecute.
    const markersToUpdate = state.narrativesNeedingUpdate || [];
    const markerKey = markersToUpdate[0];

    if (!markerKey) {
      console.log('[generate-narratives] No marker key provided - skipping');
      return {};
    }

    const currentSpec = state.currentSpec;
    if (!currentSpec) {
      console.log('[generate-narratives] No currentSpec - skipping narrative generation');
      return {};
    }

    const skeleton = currentSpec.designSpecification;
    if (!skeleton || skeleton.trim().length === 0) {
      console.error(`[generate-narratives] Empty skeleton for marker ${markerKey} - skipping`);
      return {};
    }

    console.log(`[generate-narratives] Generating narrative for marker: ${markerKey}`);

    const narrativeStyleGuidance = state.narrativeStyleGuidance ||
      "No specific narrative style guidance provided. Use appropriate tone and style based on the game type and context.";

    const systemMessage = createCachedSystemMessage(SYSTEM_PROMPT, {
      skeleton,
      narrativeStyleGuidance,
      markerKey,
    });

    try {
      const response = await model.invokeWithMessages(
        [systemMessage, new HumanMessage("Begin.")],
        {
          agent: "narrative-generation-agent",
          workflow: "design",
          markerKey,
        }
      );

      const narrativeContent = (response.content as string).trim();
      console.log(`[generate-narratives] Generated ${narrativeContent.length} chars for ${markerKey}`);

      return {
        specNarratives: { [markerKey]: narrativeContent },
        narrativesNeedingUpdate: [], // Clear for this branch
      };
    } catch (error) {
      console.error(`[generate-narratives] Error generating narrative for ${markerKey}:`, error);
      return {};
    }
  };
}
