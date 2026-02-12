/**
 * Node Factories for Spec Processing Graph
 *
 * Factory functions for creating standardized nodes from NodeConfig.
 * Used by graph builder to construct validation, commit, and cleanup nodes.
 */

import {
  SpecProcessingState,
  SpecProcessingStateType,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/spec-processing-state.js";
import {
  GraphConfigWithStore,
  putToStore,
  Validator,
  isDebugEnabled,
  getFromStore,
  NodeConfig,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/node-shared.js";
import { END, START, StateGraph } from "@langchain/langgraph";

const ValidationErrorsKey = "validation_errors";

/**
 * Create a validator node from a list of validator functions.
 *
 * Runs all validators against the state and store, collects errors,
 * and stores them in InMemoryStore for routing decisions.
 *
 * @param namespace - Extraction namespace (schema, instructions, transitions)
 * @param stage - Validation stage (plan, execution)
 * @param validators - Array of validator functions to run
 * @param maxAttempts - Maximum retry attempts for this stage
 * @returns Node function that validates and stores errors
 */
export function createValidatorNode(
  namespace: string,
  stage: "plan" | "execution",
  validators: Validator[]
) {
  return async (
    state: SpecProcessingStateType,
    config?: GraphConfigWithStore
  ): Promise<Partial<SpecProcessingStateType>> => {
    const store = config?.store;
    const threadId = config?.configurable?.thread_id || "default";

    if (!store) {
      throw new Error(`[${namespace}_${stage}_validator] Store not configured`);
    }

    console.debug(
      `[${namespace}_${stage}_validator] Running ${validators.length} validators`
    );

    // Run all validators
    const allErrors: string[] = [];
    for (const validator of validators) {
      const errors = await validator(state, store, threadId);
      allErrors.push(...errors);
    }

    // Store errors in InMemoryStore for routing
    await putToStore(store, [namespace, stage, ValidationErrorsKey], threadId, allErrors);

    if (allErrors.length > 0) {
      console.warn(
        `[${namespace}_${stage}_validator] Validation failed with ${allErrors.length} errors:`
      );
      allErrors.forEach((error, index) => {
        console.warn(`  ${index + 1}. ${error}`);
      });
    } else {
      console.debug(`[${namespace}_${stage}_validator] Validation passed`);
    }

    // Commit node will write errors to state when max attempts reached
    // Return empty state here (errors only in InMemoryStore for routing)
    return {};
  };
}

export function createCommitNode(
  namespace: string,
  commitFunction: (
    store: any,
    state: SpecProcessingStateType,
    threadId: string
  ) => Promise<Partial<SpecProcessingStateType>>
) {
  return async (
    state: SpecProcessingStateType,
    config?: GraphConfigWithStore
  ): Promise<Partial<SpecProcessingStateType>> => {
    const store = config?.store;
    const threadId = config?.configurable?.thread_id || "default";

    if (!store) {
      throw new Error(
        `[${namespace}_commit] Store not configured - cannot commit data`
      );
    }

    console.debug(`[${namespace}_commit] Committing data to state`);

    // Get validation errors from store (if any)
    let validationErrors: string[] | null = null;
    try {
      const planErrors = await getFromStore(
        store,
        [namespace, "plan", ValidationErrorsKey],
        threadId
      );
      const executionErrors = await getFromStore(
        store,
        [namespace, "execution", ValidationErrorsKey],
        threadId
      );
      
      // Combine errors from both stages
      const allErrors = [...(planErrors || []), ...(executionErrors || [])];
      if (allErrors.length > 0) {
        validationErrors = allErrors;
        console.debug(
          `[${namespace}_commit] Including ${allErrors.length} validation errors in state`
        );
      }
    } catch (error) {
      // No errors found in store, which is fine
    }

    // If there are validation errors, only commit the errors (not invalid artifacts)
    if (validationErrors && validationErrors.length > 0) {
      console.warn(
        `[${namespace}_commit] Validation failed with ${validationErrors.length} error(s). ` +
        `Committing errors only, skipping artifact commit.`
      );
      return {
        [`${namespace}ValidationErrors`]: validationErrors,
      } as Partial<SpecProcessingStateType>;
    }

    // No validation errors - commit successful artifacts and clear stale errors
    const updates = await commitFunction(store, state, threadId);

    console.debug(`[${namespace}_commit] Commit complete, clearing stale validation errors`);

    return {
      ...updates,
      [`${namespace}ValidationErrors`]: null,  // Clear stale errors from previous runs
    } as Partial<SpecProcessingStateType>;
  };
}

/**
 * Create an extraction subgraph with planner/validator/executor/committer pattern
 *
 * Flow:
 * - With executor: START → plan → plan_validate → [retry/continue] → execute → execute_validate → [retry/commit] → commit → END
 * - Without executor: START → plan → plan_validate → [retry/commit] → commit → END
 */
export function createExtractionSubgraph(nodeConfig: NodeConfig) {
  const { namespace, planner, executor, maxAttempts, commit } = nodeConfig;
  const graph = new StateGraph(SpecProcessingState);

  // Create planner nodes (always required)
  const plannerNode = planner.node(planner.model);
  const planValidatorNode = createValidatorNode(
    namespace,
    "plan",
    planner.validators
  );

  // Create executor nodes (optional)
  let executorNode: any = undefined;
  let executorValidatorNode: any = undefined;
  if (executor) {
    executorNode = executor.node(executor.model);
    executorValidatorNode = createValidatorNode(
      namespace,
      "execution",
      executor.validators
    );
  }

  const committerNode = createCommitNode(namespace, commit);

  // Add nodes to graph
  graph.addNode(`${namespace}_plan`, plannerNode);
  graph.addNode(`${namespace}_plan_validate`, planValidatorNode);
  if (executor) {
    graph.addNode(`${namespace}_execute`, executorNode);
    graph.addNode(`${namespace}_execute_validate`, executorValidatorNode);
  }
  graph.addNode(`${namespace}_commit`, committerNode);

  // Define edges
  graph.addEdge(START, `${namespace}_plan` as any);
  graph.addEdge(
    `${namespace}_plan` as any,
    `${namespace}_plan_validate` as any
  );

  // Conditional edge after plan validation
  if (executor) {
    // With executor: plan_validate → [retry/continue/commit]
    graph.addConditionalEdges(
      `${namespace}_plan_validate` as any,
      async (_state, config) => {
        const store = (config as GraphConfigWithStore)?.store;
        const threadId = ((config as GraphConfigWithStore)?.configurable?.thread_id as string | undefined) || "default";

        // Check validation errors from store
        let errors: string[] = [];
        try {
          errors = await getFromStore(
            store,
            [namespace, "plan", ValidationErrorsKey],
            threadId
          ) || [];
        } catch {
          // No errors found, which means validation passed
        }
        if (!errors || errors.length === 0) {
          return "continue"; // Validation passed, go to executor
        }

        // Check attempt count
        let attempts = 0;
        try {
          attempts = await getFromStore(
            store,
            [namespace, "plan", "attempts"],
            threadId
          ) || 0;
        } catch {
          // No attempt count found, default to 0
        }
        if (attempts >= maxAttempts.plan) {
          return "commit"; // Max attempts reached, commit errors to state
        }

        return "retry"; // Retry planner
      },
      {
        continue: `${namespace}_execute` as any,
        retry: `${namespace}_plan` as any,
        commit: `${namespace}_commit` as any,
      }
    );
  } else {
    // Without executor: plan_validate → [retry/commit]
    graph.addConditionalEdges(
      `${namespace}_plan_validate` as any,
      async (_state, config) => {
        const store = (config as GraphConfigWithStore)?.store;
        const threadId = ((config as GraphConfigWithStore)?.configurable?.thread_id as string | undefined) || "default";

        // Check validation errors from store
        let errors: string[] = [];
        try {
          errors = await getFromStore(
            store,
            [namespace, "plan", ValidationErrorsKey],
            threadId
          ) || [];
        } catch {
          // No errors found, which means validation passed
        }
        if (!errors || errors.length === 0) {
          return "commit"; // Validation passed, go directly to commit
        }

        // Check attempt count
        let attempts = 0;
        try {
          attempts = await getFromStore(
            store,
            [namespace, "plan", "attempts"],
            threadId
          ) || 0;
        } catch {
          // No attempt count found, default to 0
        }
        if (attempts >= maxAttempts.plan) {
          return "commit"; // Max attempts reached, commit errors to state
        }

        return "retry"; // Retry planner
      },
      {
        retry: `${namespace}_plan` as any,
        commit: `${namespace}_commit` as any,
      }
    );
  }

  if (executor) {
    graph.addEdge(
      `${namespace}_execute` as any,
      `${namespace}_execute_validate` as any
    );

    // Conditional edge after execution validation
    graph.addConditionalEdges(
      `${namespace}_execute_validate` as any,
      async (_state, config) => {
        const store = (config as GraphConfigWithStore)?.store;
        const threadId = ((config as GraphConfigWithStore)?.configurable?.thread_id as string | undefined) || "default";

        let errors: string[] = [];
        try {
          errors = await getFromStore(
            store,
            [namespace, "execution", ValidationErrorsKey],
            threadId
          ) || [];
        } catch {
          // No errors found, which means validation passed
        }
        if (!errors || errors.length === 0) {
          return "commit"; // Validation passed
        }

        let attempts = 0;
        try {
          attempts = await getFromStore(
            store,
            [namespace, "execution", "attempts"],
            threadId
          ) || 0;
        } catch {
          // No attempt count found, default to 0
        }
        if (attempts >= maxAttempts.execution) {
          return "commit"; // Max attempts reached, commit errors to state
        }

        return "retry";
      },
      {
        commit: `${namespace}_commit` as any,
        retry: `${namespace}_execute` as any,
      }
    );
  }

  graph.addEdge(`${namespace}_commit` as any, END);

  return graph.compile();
}
