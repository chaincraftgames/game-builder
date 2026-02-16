/**
 * Transitions Extraction Configuration
 * 
 * Exports node configuration for transitions extraction with planner/executor pattern
 */

import { setupSpecTransitionsModel } from "#chaincraft/ai/model-config.js";
import { transitionsPlannerNode } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-transitions/planner.js";
import { transitionsExecutorNode } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-transitions/executor.js";
import {
  validatePlanCompleteness,
  validateJsonParseable,
  validateJsonLogic,
  validateNoForbiddenArrayAccess,
  validateNoExplicitPlayerReferences,
  validateTransitionCoverage,
  validateDeterministicPreconditions,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-transitions/validators.js";
import { getFromStore, NodeConfig } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/node-shared.js";

export const transitionsExtractionConfig: NodeConfig = {
  namespace: "transitions",
  
  planner: {
    node: transitionsPlannerNode,
    model: await setupSpecTransitionsModel(),
    validators: [
      validatePlanCompleteness
    ]
  },
  
  executor: {
    node: transitionsExecutorNode,
    model: await setupSpecTransitionsModel(),
    validators: [
      validateJsonParseable,
      validateJsonLogic,
      validateNoForbiddenArrayAccess,
      validateNoExplicitPlayerReferences,
      validateTransitionCoverage,
      validateDeterministicPreconditions,
    ]
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
      throw new Error("[transitions_extraction_config] Store not configured - cannot commit data");
    }

    // Retrieve execution output
    let executionOutput;
    try {
      executionOutput = await getFromStore(
        store,
        ["transitions", "execution", "output"],
        threadId
      );
    } catch (error) {
      // Executor never ran (planner failed validation), return empty updates
      // Validation errors will be added by commit node
      return {};
    }

    const transitions = typeof executionOutput === 'string' 
      ? JSON.parse(executionOutput)
      : executionOutput;

    // Return partial state to be merged
    return {
      stateTransitions: JSON.stringify(transitions, null, 2),
    };
  }
};

// Re-export utility functions for backward compatibility
export { formatComputedContextForPrompt } from "./utils.js";
