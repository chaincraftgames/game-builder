/**
 * Execute Metadata Node
 * 
 * Extracts gamepiece metadata based on the natural language plan.
 * Uses structured output with Zod schema for automatic validation.
 */

import type { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { setupSpecExecuteModel } from "#chaincraft/ai/model-config.js";
import type { GameDesignState, MetadataPlan } from "#chaincraft/ai/design/game-design-state.js";
import { SYSTEM_PROMPT, UPDATE_MODE_INSTRUCTION } from "./prompts.js";
import { GamepieceMetadataOutputSchema, validateMetadataCompleteness, type GamepieceType, type GamepieceInstance, type GamepieceMetadataOutput } from "./schemas.js";

/**
 * Formats the current metadata for inclusion in the prompt.
 */
function formatCurrentMetadata(metadata: typeof GameDesignState.State.metadata): string {
  if (!metadata || (!metadata.gamepieceTypes?.length)) {
    return "";
  }
  
  return `
**Current Metadata:**

${JSON.stringify(metadata, null, 2)}

${UPDATE_MODE_INSTRUCTION}`;
}

/**
 * Creates the metadata execution function.
 * 
 * @param model - LLM model with native structured output support
 * @returns Async function that processes state and returns metadata
 */
export function createExecuteMetadata(model: ModelWithOptions) {
  return async (state: typeof GameDesignState.State) => {
    // 1. Get the metadata change plan from state
    const { metadataChangePlan, metadata: currentMetadata } = state;
    
    if (!metadataChangePlan) {
      throw new Error(
        "[execute-metadata] No metadataChangePlan in state. This node should only be " +
        "called after plan-metadata has generated a plan."
      );
    }
    
    // 2. Format current metadata for updates (if exists)
    const currentMetadataSection = formatCurrentMetadata(currentMetadata);
    
    // 3. Build complete system prompt with all context
    // Note: We trust the plan to contain all necessary info from the spec
    const completePrompt = SYSTEM_PROMPT
      .replace("{metadataChangePlan}", metadataChangePlan)
      .replace("{currentMetadataSection}", currentMetadataSection);
    
    // 4. Call LLM with structured output (completion-style: all context in system prompt)
    const result = await model.invokeWithSystemPrompt(
      completePrompt,
      undefined, // No user prompt - completion style
      {
        agent: "metadata-execution-agent",
        workflow: "design"
      },
      GamepieceMetadataOutputSchema // Schema triggers native structured output
    ) as GamepieceMetadataOutput;
    
    // 5. Validate completeness (warnings only, don't block)
    const validation = validateMetadataCompleteness(result);
    if (!validation.isValid) {
      console.warn("[execute-metadata] Validation warnings:", validation.errors);
    }
    
    // 6. Transform to internal format (gamepiece_types → gamepieceTypes)
    const metadata = {
      gamepieceTypes: result.gamepiece_types,
      gamepieceInstances: result.gamepiece_types.flatMap((type: GamepieceType) => 
        type.instances.map((inst: GamepieceInstance) => ({
          ...inst,
          type_id: type.id
        }))
      ),
      // Note: gamepieceInventories are NOT part of metadata - they're in UX DSL
    };
    
    // 7. Return state updates
    return {
      metadata,
      lastMetadataUpdate: new Date().toISOString(),
      metadataUpdateNeeded: false, // Reset flag
    };
  };
}

/**
 * Standalone version for testing.
 * Uses setupSpecExecuteModel() (Sonnet) for high-quality structured output.
 */
export async function executeMetadata(state: typeof GameDesignState.State) {
  const model = await setupSpecExecuteModel();
  const execute = createExecuteMetadata(model);
  return execute(state);
}
