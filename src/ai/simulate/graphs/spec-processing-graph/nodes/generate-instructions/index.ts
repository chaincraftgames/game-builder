/**
 * Generate Instructions Node
 * 
 * Takes spec, schema, and transitions to generate:
 * - Phase-specific natural language instructions
 * - Map of phase name → instruction text
 * - Instructions optimized for LLM consumption (600-1000 tokens each)
 * 
 * Uses Haiku 4.5 for fast, cost-effective instruction generation.
 */

import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { SpecProcessingStateType } from "../../spec-processing-state.js";
import { executeInstructionsTemplate } from "./prompts.js";

export function generateInstructions(model: ModelWithOptions) {
  return async (state: SpecProcessingStateType): Promise<Partial<SpecProcessingStateType>> => {
    console.debug("[generate_instructions] Generating phase-specific instructions");
    
    // Generate instruction sets directly - let the AI parse the transitions document
    const executorPrompt = SystemMessagePromptTemplate.fromTemplate(executeInstructionsTemplate);
    const executorSystemMessage = await executorPrompt.format({
      gameRules: state.gameRules,
      stateSchema: state.stateSchema,
      stateTransitions: state.stateTransitions,
    });
    
    // Ask for XML output
    const instructionsResponse = (await model.invokeWithSystemPrompt(
      executorSystemMessage.content as string,
      "Generate the phase instructions as XML.",
      {
        agent: "generate-instructions",
        workflow: "spec-processing",
      }
    )).content as string;
    
    // Parse XML response
    let phaseInstructions: Record<string, string>;
    try {
      // Extract XML from markdown code blocks if present
      const xmlMatch = instructionsResponse.match(/```(?:xml)?\s*([\s\S]*?)\s*```/);
      const xmlStr = xmlMatch ? xmlMatch[1] : instructionsResponse;
      
      // Parse phase tags with regex
      phaseInstructions = {};
      const phaseRegex = /<phase\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/phase>/g;
      let match;
      
      while ((match = phaseRegex.exec(xmlStr)) !== null) {
        const phaseName = match[1];
        const content = match[2].trim();
        phaseInstructions[phaseName] = content;
      }
      
      if (Object.keys(phaseInstructions).length === 0) {
        throw new Error("No phase tags found in XML");
      }
    } catch (error) {
      console.error("[generate_instructions] Failed to parse XML response:", error);
      throw new Error("Failed to parse phase instructions XML");
    }
    
    const phaseCount = Object.keys(phaseInstructions).length;
    console.debug(`[generate_instructions] Generated instructions for ${phaseCount} phases`);
    
    return {
      phaseInstructions,
    };
  };
}
