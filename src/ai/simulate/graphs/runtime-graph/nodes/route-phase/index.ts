/**
 * Route Phase Node
 * 
 * Detects current game phase from state and determines routing decisions.
 * Returns structured output: phase name, transition readiness, and next phase
 */

import { z } from "zod";
import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { RuntimeStateType } from "../../runtime-state.js";
import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { routePhaseTemplate } from "./prompts.js";

// Structured output schema for phase routing
const PhaseRouteSchema = z.object({
  currentPhase: z.string().describe("The exact phase name from the available phases"),
  transitionReady: z.boolean().describe("True if transition conditions are met and we should transition to another phase"),
  nextPhase: z.string().describe("If transitionReady is true, the name of the phase to transition to. Empty string if no transition."),
  requiresPlayerInput: z.boolean().describe("True if this phase requires player actions to proceed (e.g., waiting for moves). False if automatic/system phase (e.g., setup, scoring)."),
  reasoning: z.string().describe("Brief explanation of the phase detection and transition decision")
});

export function routePhase(model: ModelWithOptions) {
  return async (state: RuntimeStateType): Promise<Partial<RuntimeStateType>> => {
    console.debug("[route_phase] Detecting current phase from game state");
    
    // Format available phases for the AI
    const availablePhases = Object.keys(state.phaseInstructions)
      .map(phase => `- ${phase}`)
      .join('\n');
    
    const prompt = SystemMessagePromptTemplate.fromTemplate(routePhaseTemplate);
    
    const promptMessage = await prompt.format({
      gameRules: state.gameRules,
      gameState: state.gameState,
      stateTransitions: state.stateTransitions,
      availablePhases,
    });
    
    // Use structured output for reliable parsing
    const response = await model.invokeWithSystemPrompt(
      promptMessage.content as string,
      undefined, // no user prompt
      {
        agent: "route-phase",
        workflow: "runtime",
      },
      PhaseRouteSchema
    );
    
    const result = response as z.infer<typeof PhaseRouteSchema>;
    
    // Normalize phase names - phaseInstructions may use any case
    // Create case-insensitive lookup
    const phaseInstructionsLower: Record<string, string> = {};
    const phaseCaseMapping: Record<string, string> = {}; // lowercase -> original case
    for (const key in state.phaseInstructions) {
      const lowerKey = key.toLowerCase();
      phaseInstructionsLower[lowerKey] = state.phaseInstructions[key];
      phaseCaseMapping[lowerKey] = key;
    }
    
    // Validate detected phase exists in available instructions
    let detectedPhase = result.currentPhase.trim();
    let detectedPhaseLower = detectedPhase.toLowerCase();
    if (!phaseInstructionsLower[detectedPhaseLower]) {
      console.warn(`[route_phase] Invalid phase detected: "${detectedPhase}", falling back to state parsing`);
      
      // Fallback: Parse game state directly
      try {
        const gameState = JSON.parse(state.gameState);
        detectedPhase = gameState.game?.phase || Object.keys(state.phaseInstructions)[0] || "playing";
        detectedPhaseLower = detectedPhase.toLowerCase();
      } catch (error) {
        console.error(`[route_phase] Failed to parse game state:`, error);
        detectedPhase = Object.keys(state.phaseInstructions)[0] || "playing";
        detectedPhaseLower = detectedPhase.toLowerCase();
      }
    }
    
    // Use the original case from phaseInstructions for the key
    const normalizedPhase = phaseCaseMapping[detectedPhaseLower] || detectedPhase;
    
    // Validate nextPhase if transition is ready
    let nextPhase = result.nextPhase.trim();
    let nextPhaseLower = nextPhase.toLowerCase();
    if (result.transitionReady && nextPhase && !phaseInstructionsLower[nextPhaseLower]) {
      console.warn(`[route_phase] Invalid next phase: "${nextPhase}", clearing transition`);
      nextPhase = "";
      nextPhaseLower = "";
    }
    
    // Normalize nextPhase to use original case from phaseInstructions
    const normalizedNextPhase = nextPhase ? (phaseCaseMapping[nextPhaseLower] || nextPhase) : "";
    
    // Look up instructions for the current phase using normalized key
    const selectedInstructions = state.phaseInstructions[normalizedPhase] || state.gameRules;
    
    // Get requiresPlayerInput from AI's analysis of the transitions document
    const requiresPlayerInput = result.requiresPlayerInput;
    
    console.debug(`[route_phase] Phase detected: ${normalizedPhase}`);
    console.debug(`[route_phase] Transition ready: ${result.transitionReady}`);
    if (result.transitionReady) {
      console.debug(`[route_phase] Next phase: ${normalizedNextPhase}`);
    }
    console.debug(`[route_phase] Requires player input: ${requiresPlayerInput}`);
    console.debug(`[route_phase] Reasoning: ${result.reasoning}`);
    
    return {
      currentPhase: normalizedPhase,
      selectedInstructions,
      requiresPlayerInput,
      transitionReady: result.transitionReady,
      nextPhase: normalizedNextPhase,
    };
  };
}
