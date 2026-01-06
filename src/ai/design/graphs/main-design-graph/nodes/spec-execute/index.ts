/**
 * Execute Spec Updates Node
 * 
 * Generates pure markdown specification from the change plan and metadata.
 * Reads summary and playerCount from spec_plan, generates the designSpecification.
 */

import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import type { GameDesignState, GameDesignSpecification } from "#chaincraft/ai/design/game-design-state.js";
import { SYSTEM_PROMPT, getPreservationGuidance } from "./prompts.js";

/**
 * Extracts all narrative markers from a skeleton specification.
 * 
 * @param skeleton - The skeleton specification with markers
 * @returns Array of marker keys found in the skeleton
 */
function extractMarkers(skeleton: string): string[] {
  const markerPattern = /!___ NARRATIVE:(\w+) ___!/g;
  const markers: string[] = [];
  let match;
  
  while ((match = markerPattern.exec(skeleton)) !== null) {
    markers.push(match[1]);
  }
  
  return markers;
}

/**
 * Formats the current spec for inclusion in the prompt.
 */
function formatCurrentSpec(
  currentSpec: GameDesignSpecification | undefined
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
 * Formats the change plan for inclusion in the prompt.
 */
function formatChangePlan(plan: string): string {
  return `**Change Plan:**

${plan}`;
}

/**
 * Formats player count for display.
 */
function formatPlayerCount(playerCount: { min: number; max: number }): string {
  if (playerCount.min === playerCount.max) {
    return `${playerCount.min} ${playerCount.min === 1 ? 'player' : 'players'}`;
  }
  return `${playerCount.min}-${playerCount.max} players`;
}

/**
 * Creates the spec execution function.
 * 
 * @param model - LLM model for generating specifications
 * @returns Async function that processes state and returns updates
 */
export function createSpecExecute(model: ModelWithOptions) {
  // Create system prompt template
  const systemTemplate = SystemMessagePromptTemplate.fromTemplate(SYSTEM_PROMPT);
  
  return async (state: typeof GameDesignState.State) => {
    console.log('[spec-execute] Node started');
    
    try {
      // 1. Get the pending spec changes from state
      const pendingPlans = state.pendingSpecChanges || [];
      const { currentSpec: currentGameSpec } = state;
      
      console.log(`[spec-execute] Processing ${pendingPlans.length} pending plans`);
      
      if (pendingPlans.length === 0) {
        console.error('[spec-execute] ERROR: No accumulated changes - this should not happen');
        throw new Error(
          "[spec-execute] No accumulated changes. This node should only be " +
          "called when there are changes to apply."
        );
      }
    
    // 2. Use LATEST plan's metadata
    const latestPlan = pendingPlans[pendingPlans.length - 1];
    const { summary, playerCount, changes } = latestPlan;
    
    // 3. Combine all change plans
    const changePlans = pendingPlans.length === 1
      ? pendingPlans[0].changes
      : pendingPlans
          .map((plan, i) => `**Change ${i + 1}:**\n${plan.changes}`)
          .join('\n\n');
    
    // 3. Prepare template variables
    const currentSpec = formatCurrentSpec(currentGameSpec);
    const preservationGuidance = getPreservationGuidance(!currentGameSpec);
    const formattedPlayerCount = formatPlayerCount(playerCount);
    
    // 4. Format system prompt using template
    const systemMessage = await systemTemplate.format({
      summary,
      playerCount: formattedPlayerCount,
      currentSpec,
      changePlan: changePlans,
      preservationGuidance,
    });
    
    // 5. Call LLM with formatted system prompt to generate pure markdown
    console.log('[spec-execute] Calling LLM to generate specification...');
    const startTime = Date.now();
    
    const response = await model.invokeWithSystemPrompt(
      systemMessage.content as string,
      undefined, // No user prompt needed
      {
        agent: "spec-execution-agent",
        workflow: "design"
      }
    );
    
    const designSpecification = (response.content as string).trim();
    
    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[spec-execute] LLM call completed in ${elapsedSeconds}s`);
    console.log(`[spec-execute] Generated ${designSpecification.length} chars of specification`);
    
    // 6. Extract narrative markers from the skeleton
    const markers = extractMarkers(designSpecification);
    console.log(`[spec-execute] Found ${markers.length} narrative markers: ${markers.join(', ')}`);
    
    // 7. Increment version number
    const newVersion = (state.specVersion ?? 0) + 1;
    console.log(`[spec-execute] Generated spec version ${newVersion}`);
    
    // 8. Assemble the complete GameDesignSpecification with version
    const spec: GameDesignSpecification = {
      summary,
      playerCount,
      designSpecification,
      version: newVersion,
    };
    
    // 9. Return state updates
    console.log('[spec-execute] Node completed successfully - returning state updates');
    return {
      currentSpec: spec,
      updatedSpec: spec, // Store in updatedSpec for diff comparison
      specVersion: newVersion, // Update the version counter in state
      lastSpecUpdate: new Date().toISOString(),
      lastSpecMessageCount: state.messages.length,
      specUpdateNeeded: false, // Reset the flag
      pendingSpecChanges: [], // Clear pending plans after execution
      forceSpecGeneration: false, // Reset force flag
      narrativesNeedingUpdate: markers, // Populate markers for narrative generation
    };
    } catch (error) {
      console.error('[spec-execute] ========== CRITICAL ERROR ==========');
      console.error('[spec-execute] Error:', error);
      console.error('[spec-execute] Error message:', error instanceof Error ? error.message : String(error));
      console.error('[spec-execute] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      console.error('[spec-execute] State at error:', {
        pendingPlansCount: state.pendingSpecChanges?.length || 0,
        hasCurrentSpec: !!state.currentSpec,
        messageCount: state.messages?.length || 0
      });
      console.error('[spec-execute] ====================================');
      throw error; // Re-throw to fail the graph execution
    }
  };
}

/**
 * Standalone version for testing without model dependency.
 * TODO: Remove once we have proper testing infrastructure.
 */
export async function specExecute(state: typeof GameDesignState.State) {
  throw new Error("Spec execute not yet implemented - use createSpecExecute with a model");
}
