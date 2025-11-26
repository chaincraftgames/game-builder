/**
 * Plan Changes Node
 * 
 * Reasons about what state changes are needed.
 * Handles BOTH player actions and automatic phase transitions.
 */

import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { RuntimeStateType } from "../../runtime-state.js";
import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { planPlayerActionTemplate, planPhaseTransitionTemplate } from "./prompts.js";

export function planChanges(model: ModelWithOptions) {
  return async (state: RuntimeStateType): Promise<Partial<RuntimeStateType>> => {
    // Determine what we're planning: player action or phase transition
    const isTransition = state.transitionReady && state.nextPhase;
    const isPlayerAction = state.playerAction !== undefined;
    
    if (isTransition) {
      console.debug(`[plan_changes] Planning phase transition: ${state.currentPhase} → ${state.nextPhase}`);
      
      const prompt = SystemMessagePromptTemplate.fromTemplate(planPhaseTransitionTemplate);
      
      const promptMessage = await prompt.format({
        selectedInstructions: state.selectedInstructions,
        gameState: state.gameState,
        currentPhase: state.currentPhase,
        nextPhase: state.nextPhase,
      });
      
      const response = await model.invokeWithSystemPrompt(
        promptMessage.content as string,
        undefined,
        {
          agent: "plan-changes-transition",
          workflow: "runtime",
        }
      );
      
      console.debug("[plan_changes] Transition plan complete");
      
      return {
        plannedChanges: response.content as string,
        transitionReady: false, // Clear the flag after planning
      };
      
    } else if (isPlayerAction && state.playerAction) {
      console.debug(`[plan_changes] Planning player action: ${state.playerAction.playerId} - ${state.playerAction.playerAction}`);
      
      const prompt = SystemMessagePromptTemplate.fromTemplate(planPlayerActionTemplate);
      
      const promptMessage = await prompt.format({
        selectedInstructions: state.selectedInstructions,
        gameState: state.gameState,
        playerId: state.playerAction.playerId,
        playerAction: state.playerAction.playerAction,
      });
      
      const response = await model.invokeWithSystemPrompt(
        promptMessage.content as string,
        undefined,
        {
          agent: "plan-changes-action",
          workflow: "runtime",
        }
      );
      
      console.debug("[plan_changes] Action plan complete");
      
      return {
        plannedChanges: response.content as string,
      };
      
    } else {
      console.warn("[plan_changes] Called with no action or transition - nothing to plan");
      return {
        plannedChanges: "No changes needed - no action or transition to process",
      };
    }
  };
}
