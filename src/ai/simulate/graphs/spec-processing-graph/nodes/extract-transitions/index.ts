/**
 * Extract Transitions Node
 * 
 * Analyzes game specification and identifies:
 * - Game phases (setup, playing, scoring, finished, etc.)
 * - Transition conditions (when to move between phases)
 * - Phase-specific state changes
 * - Whether each phase requires player input or is automatic
 */

import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { SpecProcessingStateType } from "../../spec-processing-state.js";
import { executeTransitionsTemplate } from "./prompts.js";

export function extractTransitions(model: ModelWithOptions) {
  return async (state: SpecProcessingStateType): Promise<Partial<SpecProcessingStateType>> => {
    console.debug("[extract_transitions] Extracting state transitions from specification");
    
    // Generate transition guide directly
    const executorPrompt = SystemMessagePromptTemplate.fromTemplate(executeTransitionsTemplate);
    const executorSystemMessage = await executorPrompt.format({
      gameRules: state.gameRules,
      stateSchema: state.stateSchema,
    });
    
    const stateTransitions = (await model.invokeWithSystemPrompt(
      executorSystemMessage.content as string,
      undefined,
      {
        agent: "extract-transitions",
        workflow: "spec-processing",
      }
    )).content as string;
    
    // Basic validation
    if (!stateTransitions || stateTransitions.length < 100) {
      throw new Error("Transition extraction produced insufficient output");
    }
    
    console.debug("[extract_transitions] Transition guide generated successfully");
    console.debug(`[extract_transitions] Output length: ${stateTransitions.length} characters`);
    
    return {
      stateTransitions,
    };
  };
}
