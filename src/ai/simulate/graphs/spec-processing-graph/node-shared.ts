/**
 * Shared configuration types for extraction nodes
 */

import { RunnableConfig } from "@langchain/core/runnables";
import { BaseStore } from "@langchain/langgraph";

import { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import { SpecProcessingStateType } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/spec-processing-state.js";

/**
 * Debug outputs configuration
 * - true: Enable debug outputs for all nodes
 * - false: Disable debug outputs for all nodes
 * - object: Enable per-node (schema, transitions, instructions)
 */
export type DebugOutputsConfig =
  | boolean
  | {
      schema?: boolean;
      transitions?: boolean;
      instructions?: boolean;
    };

export interface GraphConfigWithStore extends RunnableConfig {
  store?: BaseStore;
  configurable?: {
    thread_id?: string;
    debugOutputs?: DebugOutputsConfig;
  };
}

/**
 * Consistent validator function signature for all extraction nodes
 */
export type Validator = (
  state: SpecProcessingStateType,
  store: BaseStore,
  threadId: string,
) => Promise<string[]>;

export type CommitFunction = (
  store: BaseStore | undefined,
  state: SpecProcessingStateType,
  threadId: string,
) => Promise<Partial<SpecProcessingStateType>>;

export interface NodeConfig {
  namespace: string;
  planner?: {
    node: (
      model: ModelWithOptions,
    ) => (
      state: SpecProcessingStateType,
      config?: GraphConfigWithStore,
    ) => Promise<Partial<SpecProcessingStateType>>;
    model: ModelWithOptions;
    validators: Validator[];
  };
  executor: {
    node: (
      model: ModelWithOptions,
    ) => (
      state: SpecProcessingStateType,
      config?: GraphConfigWithStore,
    ) => Promise<Partial<SpecProcessingStateType>>;
    model: ModelWithOptions;
    validators: Validator[];
  };
  maxAttempts: {
    plan: number;
    execution: number;
  };
  commit: CommitFunction;
}

export async function getFromStore(
  store: BaseStore | undefined,
  keys: string[],
  threadId: string,
): Promise<any> {
  if (!store) {
    throw new Error("Store not configured - cannot retrieve data");
  }

  const data = await store.get(keys, threadId);
  if (!data) {
    throw new Error(`No data found in store for keys: ${keys.join(", ")}`);
  }

  // BaseStore returns { value: actualValue, key, namespace, ... }
  return data.value;
}

export function putToStore(
  store: BaseStore | undefined,
  keys: string[],
  threadId: string,
  value: any,
): Promise<void> {
  if (!store) {
    throw new Error("Store not configured - cannot put data");
  }

  // Pass the raw value - BaseStore will wrap it in its own format
  return store.put(keys, threadId, value);
}

export function getAttemptCount(
  store: BaseStore | undefined,
  namespace: string,
  phase: "plan" | "execution",
  threadId: string,
) {
  return getFromStore(store, [namespace, phase, "attempts"], threadId)
    .then((count) => count || 0)
    .catch(() => 0);
}

export function incrementAttemptCount(
  store: BaseStore | undefined,
  namespace: string,
  phase: "plan" | "execution",
  threadId: string,
): Promise<void> {
  return getAttemptCount(store, namespace, phase, threadId).then(
    (currentCount) => {
      const newCount = currentCount + 1;
      // Store just the number - putToStore will wrap it
      return putToStore(
        store,
        [namespace, phase, "attempts"],
        threadId,
        newCount,
      );
    },
  );
}

/**
 * Check if debug outputs are enabled for a specific namespace
 * @param config - Graph config with debugOutputs setting
 * @param namespace - Node namespace (schema, transitions, instructions)
 * @returns True if debug outputs should be written to state
 */
export function isDebugEnabled(
  config: GraphConfigWithStore | undefined,
  namespace: string,
): boolean {
  const debugOutputs = config?.configurable?.debugOutputs;

  if (debugOutputs === undefined) return false;
  if (typeof debugOutputs === "boolean") return debugOutputs;

  // Check specific namespace
  return debugOutputs[namespace as keyof typeof debugOutputs] ?? false;
}
