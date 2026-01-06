/**
 * Generate Narratives Node
 * 
 * Generates narrative content for markers in the skeleton specification.
 * Processes all markers listed in narrativesNeedingUpdate and stores results in specNarratives.
 */

import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import type { GameDesignState } from "#chaincraft/ai/design/game-design-state.js";
import { createCachedSystemMessage } from "#chaincraft/ai/prompt-template-processor.js";
import { SYSTEM_PROMPT } from "./prompts.js";

/**
 * Creates the narrative generation function.
 * 
 * @param model - LLM model for generating narrative content
 * @returns Async function that processes state and returns updates
 */
export function createGenerateNarratives(model: ModelWithOptions) {
  return async (state: typeof GameDesignState.State) => {
    // 1. Get the skeleton from currentSpec
    const currentSpec = state.currentSpec;
    if (!currentSpec) {
      console.log('[generate-narratives] No currentSpec - skipping narrative generation');
      return { narrativesNeedingUpdate: [] };
    }
    
    const skeleton = currentSpec.designSpecification;
    
    // 2. Get markers that need updating
    const markersToUpdate = state.narrativesNeedingUpdate || [];
    
    if (markersToUpdate.length === 0) {
      console.log('[generate-narratives] No markers to update - skipping');
      return {};
    }
    
    console.log(`[generate-narratives] Generating narratives for ${markersToUpdate.length} markers: ${markersToUpdate.join(', ')}`);
    
    // 3. Get narrative style guidance (or use default)
    const narrativeStyleGuidance = state.narrativeStyleGuidance || 
      "No specific narrative style guidance provided. Use appropriate tone and style based on the game type and context.";
    
    // 4. Generate narrative content for each marker
    const existingNarratives = state.specNarratives || {};
    const updatedNarratives: Record<string, string> = { ...existingNarratives };
    
    for (const markerKey of markersToUpdate) {
      console.log(`[generate-narratives] Processing marker: ${markerKey}`);
      
      // Create system message with caching
      // Static content (guidelines) is cached, dynamic content (skeleton, task) is not
      const systemMessage = createCachedSystemMessage(SYSTEM_PROMPT, {
        skeleton,
        narrativeStyleGuidance,
        markerKey,
      });
      
      try {
        // Call LLM to generate narrative content
        const response = await model.invokeWithMessages(
          [systemMessage],
          {
            agent: "narrative-generation-agent",
            workflow: "design",
            markerKey,
          }
        );
        
        const narrativeContent = (response.content as string).trim();
        updatedNarratives[markerKey] = narrativeContent;
        
        console.log(`[generate-narratives] Generated ${narrativeContent.length} chars for ${markerKey}`);
      } catch (error) {
        console.error(`[generate-narratives] Error generating narrative for ${markerKey}:`, error);
        // Continue with other markers even if one fails
      }
    }
    
    // 5. Return state updates
    return {
      specNarratives: updatedNarratives,
      narrativesNeedingUpdate: [], // Clear the list after processing
    };
  };
}
