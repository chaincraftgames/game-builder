import dotenv from "dotenv";
import { HumanMessage, BaseMessage, SystemMessage } from "@langchain/core/messages";
import { getModel } from "#chaincraft/ai/model.js";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";

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
  invoke: (prompt: string, metadata?: Record<string, any>, schema?: any) => Promise<ModelResponse | any>;
  invokeWithMessages: (messages: BaseMessage[], metadata?: Record<string, any>, schema?: any) => Promise<ModelResponse | any>;
  invokeWithSystemPrompt: (
    systemPrompt: string,
    userPrompt?: string,
    metadata?: Record<string, any>,
    schema?: any
  ) => Promise<ModelResponse | any>;
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
  useDesignDefaults?: boolean;
  useSimulationDefaults?: boolean;
  maxTokens?: number;
}

/**
 * Default configuration for design workflows
 */
const DESIGN_DEFAULTS = {
  modelName: process.env.CHAINCRAFT_DESIGN_MODEL_NAME || "",
  tracerProjectName:
    process.env.CHAINCRAFT_DESIGN_TRACER_PROJECT ||
    "chaincraft-design",
};

/**
 * Default configuration for simulation workflows
 */
const SIMULATION_DEFAULTS = {
  modelName: process.env.CHAINCRAFT_SIMULATION_MODEL_NAME || "",
  tracerProjectName:
    process.env.CHAINCRAFT_SIMULATION_TRACER_PROJECT ||
    "chaincraft-simulation",
};

/**
 * Default configuration for spec-plan agent
 */
const SPEC_PLAN_DEFAULTS = {
  modelName: process.env.CHAINCRAFT_SPEC_PLAN_MODEL || process.env.CHAINCRAFT_DESIGN_MODEL_NAME || "",
  tracerProjectName: process.env.CHAINCRAFT_DESIGN_TRACER_PROJECT || "chaincraft-design",
};

/**
 * Default configuration for spec-execute agent
 */
const SPEC_EXECUTE_DEFAULTS = {
  modelName: process.env.CHAINCRAFT_SPEC_EXECUTE_MODEL || process.env.CHAINCRAFT_DESIGN_MODEL_NAME || "",
  tracerProjectName: process.env.CHAINCRAFT_DESIGN_TRACER_PROJECT || "chaincraft-design",
};

/**
 * Default configuration for spec-diff agent
 */
const SPEC_DIFF_DEFAULTS = {
  modelName: process.env.CHAINCRAFT_SPEC_DIFF_MODEL || process.env.CHAINCRAFT_DESIGN_MODEL_NAME || "",
  tracerProjectName: process.env.CHAINCRAFT_DESIGN_TRACER_PROJECT || "chaincraft-design",
};

/**
 * Default configuration for schema extraction
 * Falls back to SIMULATION_MODEL_NAME if not specified (override recommended with Sonnet)
 */
const SIM_SCHEMA_EXTRACTION_DEFAULTS = {
  modelName: process.env.CHAINCRAFT_SIM_SCHEMA_EXTRACTION_MODEL || process.env.CHAINCRAFT_SIMULATION_MODEL_NAME || "",
  tracerProjectName: process.env.CHAINCRAFT_SIMULATION_TRACER_PROJECT || "chaincraft-simulation",
};

/**
 * Default configuration for transition extraction
 * Uses SIMULATION_MODEL_NAME by default (Haiku 4.5 recommended for cost-effectiveness)
 */
const SIM_TRANSITIONS_EXTRACTION_DEFAULTS = {
  modelName: process.env.CHAINCRAFT_SPEC_TRANSITIONS_MODEL || process.env.CHAINCRAFT_SIMULATION_MODEL_NAME || "",
  tracerProjectName: process.env.CHAINCRAFT_SIMULATION_TRACER_PROJECT || "chaincraft-simulation",
};

/**
 * Default configuration for instructions planning extraction
 * Uses Sonnet 4.5 by default for high-quality planning
 */
const SIM_INSTRUCTIONS_DEFAULTS = {
  modelName: process.env.CHAINCRAFT_SIM_INSTRUCTIONS_MODEL || process.env.CHAINCRAFT_SIMULATION_MODEL_NAME || "",
  tracerProjectName: process.env.CHAINCRAFT_SIMULATION_TRACER_PROJECT || "chaincraft-simulation",
  maxTokens: 16384, // Required for comprehensive instruction planning output
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

  if (options.useDesignDefaults) {
    modelName = options.modelName || DESIGN_DEFAULTS.modelName;
    tracerProjectName =
      options.tracerProjectName || DESIGN_DEFAULTS.tracerProjectName;
  } else if (options.useSimulationDefaults) {
    modelName = options.modelName || SIMULATION_DEFAULTS.modelName;
    tracerProjectName =
      options.tracerProjectName || SIMULATION_DEFAULTS.tracerProjectName;
  } else {
    // Use explicit options or design defaults as fallback
    modelName = options.modelName || DESIGN_DEFAULTS.modelName;
    tracerProjectName = options.tracerProjectName || DESIGN_DEFAULTS.tracerProjectName;
  }

  console.log(
    `[DEBUG] setupModel - modelName: ${modelName}, tracerProjectName: ${tracerProjectName}`
  );

  if (!modelName) {
    throw new Error(
      "Model name must be provided either through options or environment variables"
    );
  }

  const model = await getModel(modelName, options.maxTokens);

  // Create tracer callbacks based on configuration
  const callbacks = createTracerCallbacks(tracerProjectName);

  // Create invoke options object (maxTokens now set in model constructor, not here)
  const invokeOptions = {
    callbacks,
  };

  // Create convenient invoke method that uses the pre-configured options
  const invoke = async (prompt: string, metadata?: Record<string, any>, schema?: any): Promise<ModelResponse | any> => {
    if (schema) {
      const structuredModel = (model as any).withStructuredOutput(schema, {
        maxTokens: 8192
      });
      
      const invokeOptionsWithMetadata = {
        ...invokeOptions,
        ...(metadata ? { metadata } : {}),
      };
      
      return await structuredModel.invoke(
        [new HumanMessage(prompt)],
        invokeOptionsWithMetadata
      );
    }
    
    // Non-schema path: maxTokens set in model constructor
    const invokeOptionsWithMetadata = {
      ...invokeOptions,
      ...(metadata ? { metadata } : {}),
    };
    
    return (await model.invoke(
      prompt,
      invokeOptionsWithMetadata
    )) as ModelResponse;
  };

  // Create invoke method that accepts full message history
  const invokeWithMessages = async (messages: BaseMessage[], metadata?: Record<string, any>, schema?: any): Promise<ModelResponse | any> => {
    if (schema) {
      const structuredModel = (model as any).withStructuredOutput(schema, {
        maxTokens: 8192
      });
      
      const invokeOptionsWithMetadata = {
        ...invokeOptions,
        ...(metadata ? { metadata } : {}),
      };
      
      return await structuredModel.invoke(
        messages,
        invokeOptionsWithMetadata
      );
    }
    
    const invokeOptionsWithMetadata = {
      ...invokeOptions,
      ...(metadata ? { metadata } : {}),
    };
    
    return (await model.invoke(
      messages,
      invokeOptionsWithMetadata
    )) as ModelResponse;
  };

  // Create invoke method with explicit system prompt for completion-style tasks
  const invokeWithSystemPrompt = async (
    systemPrompt: string,
    userPrompt?: string,
    metadata?: Record<string, any>,
    schema?: any
  ): Promise<ModelResponse | any> => {
    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt || "Begin.")
    ];
    
    if (schema) {
      // withStructuredOutput accepts config as second parameter for Anthropic models
      const structuredModel = (model as any).withStructuredOutput(schema, {
        maxTokens: 8192
      });
      
      const invokeOptionsWithMetadata = {
        ...invokeOptions,
        ...(metadata ? { metadata } : {}),
      };
      
      return await structuredModel.invoke(
        messages,
        invokeOptionsWithMetadata
      );
    }
    
    const invokeOptionsWithMetadata = {
      ...invokeOptions,
      ...(metadata ? { metadata } : {}),
    };
    
    return (await model.invoke(
      messages,
      invokeOptionsWithMetadata
    )) as ModelResponse;
  };

  return {
    model,
    modelName,
    tracerProjectName,
    invokeOptions,
    invoke,
    invokeWithMessages,
    invokeWithSystemPrompt,
  };
};

/**
 * Setup model specifically for discovery workflows
 * @param options Optional configuration overrides
 * @returns Promise resolving to ModelSetup configured for discovery
 */
export const setupDesignModel = async (
  options: Omit<
    ModelConfigOptions,
    "useDesignDefaults" | "useSimulationDefaults"
  > = {}
): Promise<ModelWithOptions> => {
  return setupModel({ ...options, useDesignDefaults: true });
};

/**
 * Setup model specifically for simulation workflows
 * @param options Optional configuration overrides
 * @returns Promise resolving to ModelSetup configured for simulation
 */
export const setupSimulationModel = async (
  options: Omit<
    ModelConfigOptions,
    "useDesignDefaults" | "useSimulationDefaults"
  > = {}
): Promise<ModelWithOptions> => {
  return setupModel({ ...options, useSimulationDefaults: true });
};

/**
 * Setup model specifically for spec-plan agent
 * Uses Haiku by default for fast, cost-effective metadata extraction
 * @param options Optional configuration overrides
 * @returns Promise resolving to ModelSetup configured for spec-plan
 */
export const setupSpecPlanModel = async (
  options: Omit<
    ModelConfigOptions,
    "useDesignDefaults" | "useSimulationDefaults"
  > = {}
): Promise<ModelWithOptions> => {
  const modelName = options.modelName || SPEC_PLAN_DEFAULTS.modelName;
  const tracerProjectName = options.tracerProjectName || SPEC_PLAN_DEFAULTS.tracerProjectName;
  return setupModel({ modelName, tracerProjectName });
};

/**
 * Setup model specifically for spec-execute agent
 * Uses Sonnet by default for high-quality, comprehensive specification generation
 * @param options Optional configuration overrides
 * @returns Promise resolving to ModelSetup configured for spec-execute
 */
export const setupSpecExecuteModel = async (
  options: Omit<
    ModelConfigOptions,
    "useDesignDefaults" | "useSimulationDefaults"
  > = {}
): Promise<ModelWithOptions> => {
  const modelName = options.modelName || SPEC_EXECUTE_DEFAULTS.modelName;
  const tracerProjectName = options.tracerProjectName || SPEC_EXECUTE_DEFAULTS.tracerProjectName;
  return setupModel({ modelName, tracerProjectName });
};

/**
 * Setup model specifically for spec-diff agent
 * Uses Haiku by default for fast, cost-effective diff analysis
 * @param options Optional configuration overrides
 * @returns Promise resolving to ModelSetup configured for spec-diff
 */
export const setupSpecDiffModel = async (
  options: Omit<
    ModelConfigOptions,
    "useDesignDefaults" | "useSimulationDefaults"
  > = {}
): Promise<ModelWithOptions> => {
  const modelName = options.modelName || SPEC_DIFF_DEFAULTS.modelName;
  const tracerProjectName = options.tracerProjectName || SPEC_DIFF_DEFAULTS.tracerProjectName;
  return setupModel({ modelName, tracerProjectName });
};

/**
 * Setup model specifically for spec processing (schema extraction)
 * Uses Sonnet by default for high-quality schema generation with complex structured output
 * Haiku hits token limits with detailed schemas, so Sonnet is required
 * @param options Optional configuration overrides
 * @returns Promise resolving to ModelSetup configured for spec processing
 */
export const setupSpecProcessingModel = async (
  options: Omit<
    ModelConfigOptions,
    "useDesignDefaults" | "useSimulationDefaults"
  > = {}
): Promise<ModelWithOptions> => {
  const modelName = options.modelName || SIM_SCHEMA_EXTRACTION_DEFAULTS.modelName;
  const tracerProjectName = options.tracerProjectName || SIM_SCHEMA_EXTRACTION_DEFAULTS.tracerProjectName;
  return setupModel({ modelName, tracerProjectName });
};

/**
 * Setup model specifically for transition extraction
 * Uses Haiku by default for cost-effective transition analysis
 * @param options Optional configuration overrides
 * @returns Promise resolving to ModelSetup configured for transition extraction
 */
export const setupSpecTransitionsModel = async (
  options: Omit<
    ModelConfigOptions,
    "useDesignDefaults" | "useSimulationDefaults"
  > = {}
): Promise<ModelWithOptions> => {
  const modelName = options.modelName || SIM_TRANSITIONS_EXTRACTION_DEFAULTS.modelName;
  const tracerProjectName = options.tracerProjectName || SIM_TRANSITIONS_EXTRACTION_DEFAULTS.tracerProjectName;
  return setupModel({ modelName, tracerProjectName });
};

/**
 * Setup model specifically for transition extraction
 * Uses Haiku by default for cost-effective transition analysis
 * @param options Optional configuration overrides
 * @returns Promise resolving to ModelSetup configured for transition extraction
 */
export const setupSpecInstructionsModel = async (
  options: Omit<
    ModelConfigOptions,
    "useDesignDefaults" | "useSimulationDefaults"
  > = {}
): Promise<ModelWithOptions> => {
  const modelName = options.modelName || SIM_INSTRUCTIONS_DEFAULTS.modelName;
  const tracerProjectName = options.tracerProjectName || SIM_INSTRUCTIONS_DEFAULTS.tracerProjectName;
  const maxTokens = options.maxTokens || SIM_INSTRUCTIONS_DEFAULTS.maxTokens;
  return setupModel({ modelName, tracerProjectName, maxTokens });
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
