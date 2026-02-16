/**
 * Instructions Extraction Configuration
 */

import { setupSpecInstructionsModel } from "#chaincraft/ai/model-config.js";
import { instructionsPlannerNode } from "./planner.js";
import { instructionsExecutorNode } from "./executor.js";
import {
  validatePlanCompleteness,
  validateJsonParseable,
  validateInitializationCompleteness,
  validateActionRequiredSet,
  validateNarrativeMarkers,
  validateArtifactStructure,
  validateInitialStatePreconditions,
  validatePathStructure,
  validateGameCompletion,
  validatePhaseConnectivity,
  validateFieldCoverage,
} from "./validators.js";
import { NodeConfig, getFromStore } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/node-shared.js";
import { resolvePositionalPlayerTemplates } from "./utils.js";
import type { InstructionsArtifact } from "#chaincraft/ai/simulate/schema.js";

export const instructionsExtractionConfig: NodeConfig = {
  namespace: "instructions",
  
  planner: {
    node: instructionsPlannerNode,
    model: await setupSpecInstructionsModel(),
    validators: [validatePlanCompleteness]
  },
  
  executor: {
    node: instructionsExecutorNode,
    model: await setupSpecInstructionsModel(),
    validators: [
      validateJsonParseable,
      validatePathStructure,
      validateArtifactStructure,
      validatePhaseConnectivity,
      validateInitializationCompleteness,
      validateActionRequiredSet,
      validateNarrativeMarkers,
      validateInitialStatePreconditions,
      validateGameCompletion,
      validateFieldCoverage,
    ],
  },
  
  maxAttempts: {
    plan: 1,
    execution: 1
  },

  commit: async (
    store,
    state,
    threadId
  ) => {
    if (!store) {
      throw new Error("[instructions_extraction_config] Store not configured - cannot commit data");
    }

    // Retrieve execution output
    let executionOutput;
    try {
      executionOutput = await getFromStore(
        store,
        ["instructions", "execution", "output"],
        threadId
      );
    } catch (error) {
      // Executor never ran (planner failed validation), return empty updates
      // Validation errors will be added by commit node
      return {};
    }

    let instructions: InstructionsArtifact = typeof executionOutput === 'string' 
      ? JSON.parse(executionOutput)
      : executionOutput;

    // Resolve positional player templates
    instructions = resolvePositionalPlayerTemplates(instructions);

    // Build separated instruction maps
    const playerPhaseInstructionsMap: Record<string, string> = {};
    const transitionInstructionsMap: Record<string, string> = {};
    
    // Add player phase instructions (keyed by phase name)
    for (const [phaseName, phaseInstructions] of Object.entries(instructions.playerPhases)) {
      playerPhaseInstructionsMap[phaseName] = JSON.stringify(phaseInstructions, null, 2);
    }
    
    // Add transition instructions (keyed by transition ID)
    for (const [transitionId, transitionInstructions] of Object.entries(instructions.transitions)) {
      transitionInstructionsMap[transitionId] = JSON.stringify(transitionInstructions, null, 2);
    }
    
    console.debug(
      `[instructions_commit] Built instruction maps: ${Object.keys(instructions.playerPhases).length} player phases, ` +
      `${Object.keys(instructions.transitions).length} transitions`
    );

    // Return partial state to be merged
    return {
      playerPhaseInstructions: playerPhaseInstructionsMap,
      transitionInstructions: transitionInstructionsMap,
    };
  }
};

// Re-export utility functions for backward compatibility
export { resolvePositionalPlayerTemplates } from "./utils.js";
