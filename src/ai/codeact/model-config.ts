import dotenv from "dotenv";
import { HumanMessage } from "@langchain/core/messages";
import { getModel } from "#chaincraft/ai/model.js";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";
import exp from "constants";

// Load environment variables
dotenv.config();

/**
 * Model setup result interface
 */
export interface ModelWithOptions {
  model: BaseChatModel;
  modelName: string;
  tracerProjectName?: string;
  invokeOptions: {
    callbacks: any[];
  };
  invoke: (prompt: string, metadata?: Record<string, any>) => Promise<ModelResponse>;
}

/**
 * Model invocation response interface
 */
export interface ModelResponse {
  content: string;
  [key: string]: any;
}

/**
 * Model configuration options
 */
export interface ModelConfigOptions {
  modelName?: string;
  tracerProjectName?: string;
  useDiscoveryDefaults?: boolean;
  useSimulationDefaults?: boolean;
}

/**
 * Default configuration for discovery workflows
 */
const DISCOVERY_DEFAULTS = {
  modelName: process.env.CHAINCRAFT_CODEACT_DISCOVERY_MODEL_NAME || "",
  tracerProjectName:
    process.env.CHAINCRAFT_CODEACT_DISCOVERY_TRACER_PROJECT ||
    "chaincraft-codeact-discovery",
};

/**
 * Default configuration for simulation workflows
 */
const SIMULATION_DEFAULTS = {
  modelName:
    process.env.CHAINCRAFT_CODEACT_SIMULATION_MODEL_NAME ||
    process.env.CHAINCRAFT_CODEACT_DISCOVERY_MODEL_NAME ||
    "",
  tracerProjectName:
    process.env.CHAINCRAFT_CODEACT_SIMULATION_TRACER_PROJECT ||
    "chaincraft-codeact-simulation",
};

/**
 * Configure the model with flexible options for different workflows
 * @param options Configuration options for the model setup
 * @returns Promise resolving to ModelSetup with model instance and configuration
 */
export const setupModel = async (
  options: ModelConfigOptions = {}
): Promise<ModelWithOptions> => {
  let modelName: string;
  let tracerProjectName: string | undefined;

  if (options.useDiscoveryDefaults) {
    modelName = options.modelName || DISCOVERY_DEFAULTS.modelName;
    tracerProjectName =
      options.tracerProjectName || DISCOVERY_DEFAULTS.tracerProjectName;
  } else if (options.useSimulationDefaults) {
    modelName = options.modelName || SIMULATION_DEFAULTS.modelName;
    tracerProjectName =
      options.tracerProjectName || SIMULATION_DEFAULTS.tracerProjectName;
  } else {
    // Use explicit options or discovery defaults as fallback
    modelName = options.modelName || DISCOVERY_DEFAULTS.modelName;
    tracerProjectName = options.tracerProjectName;
  }

  console.log(
    `[DEBUG] setupModel - modelName: ${modelName}, tracerProjectName: ${tracerProjectName}`
  );

  if (!modelName) {
    throw new Error(
      "Model name must be provided either through options or environment variables"
    );
  }

  const model = await getModel(modelName);

  // Create tracer callbacks based on configuration
  const callbacks = createTracerCallbacks(tracerProjectName);

  // Create invoke options object
  const invokeOptions = {
    callbacks,
  };

  // Create convenient invoke method that uses the pre-configured options
  const invoke = async (prompt: string, metadata?: Record<string, any>): Promise<ModelResponse> => {
    const invokeOptionsWithMetadata = {
      ...invokeOptions,
      metadata: {
        ...metadata
      }
    };
    
    return (await model.invoke(
      [new HumanMessage(prompt)],
      invokeOptionsWithMetadata
    )) as ModelResponse;
  };

  return {
    model,
    modelName,
    tracerProjectName,
    invokeOptions,
    invoke,
  };
};

/**
 * Setup model specifically for discovery workflows
 * @param options Optional configuration overrides
 * @returns Promise resolving to ModelSetup configured for discovery
 */
export const setupDiscoveryModel = async (
  options: Omit<
    ModelConfigOptions,
    "useDiscoveryDefaults" | "useSimulationDefaults"
  > = {}
): Promise<ModelWithOptions> => {
  return setupModel({ ...options, useDiscoveryDefaults: true });
};

/**
 * Setup model specifically for simulation workflows
 * @param options Optional configuration overrides
 * @returns Promise resolving to ModelSetup configured for simulation
 */
export const setupSimulationModel = async (
  options: Omit<
    ModelConfigOptions,
    "useDiscoveryDefaults" | "useSimulationDefaults"
  > = {}
): Promise<ModelWithOptions> => {
  return setupModel({ ...options, useSimulationDefaults: true });
};

/**
 * Invoke the model with a prompt (backward compatible API)
 * @param model The ModelWithOptions to use
 * @param prompt The prompt text to send to the model
 * @param callbacks Optional additional callbacks for tracing
 * @param metadata Optional metadata to include in the trace
 * @returns Promise resolving to the model's response
 */
export const invokeModel = async (
  model: ModelWithOptions,
  prompt: string,
  callbacks?: any[],
  metadata?: Record<string, any>
): Promise<ModelResponse> => {
  // Merge the configured callbacks with any additional callbacks (without mutating)
  const allCallbacks = [
    ...model.invokeOptions.callbacks,
    ...(callbacks || [])
  ];
  
  const invokeOptions = {
    callbacks: allCallbacks,
    metadata: {
      ...metadata
    }
  };
  
  return (await model.model.invoke(
    [new HumanMessage(prompt)],
    invokeOptions
  )) as ModelResponse;
};

/**
 * Create callbacks array with tracer project name if provided
 * @param tracerProjectName Optional tracer project name for tracing
 * @returns Array of callbacks for model invocation
 */
export const createTracerCallbacks = (tracerProjectName?: string): any[] => {
  console.log(
    `[DEBUG] createTracerCallbacks called with tracerProjectName: ${tracerProjectName}`
  );

  if (!tracerProjectName) {
    console.log(
      `[DEBUG] No tracer project name provided, returning empty callbacks`
    );
    return [];
  }

  // Create LangChain tracer with the specified project name
  const tracer = new LangChainTracer({
    projectName: tracerProjectName,
  });

  console.log(`[DEBUG] Created tracer for project: ${tracerProjectName}`);
  return [tracer];
};
