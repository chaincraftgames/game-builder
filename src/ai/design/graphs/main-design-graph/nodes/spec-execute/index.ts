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
    // 1. Get the spec plan from state
    const { specPlan, currentGameSpec } = state;
    
    if (!specPlan) {
      throw new Error(
        "[spec-execute] No specPlan in state. This node should only be " +
        "called after spec-plan has generated a plan."
      );
    }
    
    // 2. Extract metadata from specPlan
    const { summary, playerCount, changes } = specPlan;
    
    // 3. Prepare template variables
    const currentSpec = formatCurrentSpec(currentGameSpec);
    const changePlan = formatChangePlan(changes);
    const preservationGuidance = getPreservationGuidance(!currentGameSpec);
    const formattedPlayerCount = formatPlayerCount(playerCount);
    
    // 4. Format system prompt using template
    const systemMessage = await systemTemplate.format({
      summary,
      playerCount: formattedPlayerCount,
      currentSpec,
      changePlan,
      preservationGuidance,
    });
    
    // 5. Call LLM with formatted system prompt to generate pure markdown
    const response = await model.invokeWithSystemPrompt(
      systemMessage.content as string,
      undefined, // No user prompt needed
      {
        agent: "spec-execution-agent",
        workflow: "design"
      }
    );
    
    const designSpecification = (response.content as string).trim();
    
    // 6. Increment version number
    const newVersion = (state.specVersion ?? 0) + 1;
    
    // 7. Assemble the complete GameDesignSpecification with version
    const spec: GameDesignSpecification = {
      summary,
      playerCount,
      designSpecification,
      version: newVersion,
    };
    
    // 8. Return state updates
    return {
      spec,
      updatedSpec: spec, // Store in updatedSpec for diff comparison
      specVersion: newVersion, // Update the version counter in state
      lastSpecUpdate: new Date().toISOString(),
      lastSpecMessageCount: state.messages.length,
      specUpdateNeeded: false, // Reset the flag
    };
  };
}

/**
 * Standalone version for testing without model dependency.
 * TODO: Remove once we have proper testing infrastructure.
 */
export async function specExecute(state: typeof GameDesignState.State) {
  throw new Error("Spec execute not yet implemented - use createSpecExecute with a model");
}
