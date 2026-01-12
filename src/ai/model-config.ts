import dotenv from "dotenv";
import dotenvExpand from "dotenv-expand";
import {
  HumanMessage,
  BaseMessage,
  SystemMessage,
  MessageContentText,
} from "@langchain/core/messages";
import { getModel } from "#chaincraft/ai/model.js";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";
import { createCachedSystemMessage } from "#chaincraft/ai/prompt-template-processor.js";

// Load environment variables with expansion support
const myEnv = dotenv.config();
dotenvExpand.expand(myEnv);

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
  invoke: (
    prompt: string,
    metadata?: Record<string, any>,
    schema?: any
  ) => Promise<ModelResponse | any>;
  invokeWithMessages: (
    messages: BaseMessage[],
    metadata?: Record<string, any>,
    schema?: any
  ) => Promise<ModelResponse | any>;
  invokeWithSystemPrompt: (
    systemPrompt: string,
    userPrompt?: string,
    metadata?: Record<string, any>,
    schema?: any
  ) => Promise<ModelResponse | any>;
  /**
   * Allows us to create an invocation with cached context
   * @returns an InvocationBuilder instance
   */
  createInvocation?: (
    metadata?: Record<string, any>,
    schema?: any
  ) => InvocationBuilder;
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
export interface InvocationBuilder {
  addSystemPrompt: (systemPrompt: string) => InvocationBuilder;
  addCachedSystemPrompt: (systemPrompt: string) => InvocationBuilder;
  addUserPrompt: (userPrompt: string) => InvocationBuilder;
  invoke(): Promise<ModelResponse | any>;
}

/**
 * Default configuration for design workflows
 */
const DESIGN_DEFAULTS = {
  modelName: process.env.CHAINCRAFT_DESIGN_MODEL_NAME || "",
  tracerProjectName:
    process.env.CHAINCRAFT_DESIGN_TRACER_PROJECT || "chaincraft-design",
};

/**
 * Default configuration for simulation workflows
 */
const SIMULATION_DEFAULTS = {
  modelName: process.env.CHAINCRAFT_SIMULATION_MODEL_NAME || "",
  tracerProjectName:
    process.env.CHAINCRAFT_SIMULATION_TRACER_PROJECT || "chaincraft-simulation",
};

/**
 * Default configuration for conversational agent
 */
const CONVERSATIONAL_AGENT_DEFAULTS = {
  modelName:
    process.env.CHAINCRAFT_CONVERSATIONAL_AGENT_MODEL ||
    process.env.CHAINCRAFT_DESIGN_MODEL_NAME ||
    "",
  tracerProjectName:
    process.env.CHAINCRAFT_DESIGN_TRACER_PROJECT || "chaincraft-design",
};

/**
 * Default configuration for spec-plan agent
 */
const SPEC_PLAN_DEFAULTS = {
  modelName:
    process.env.CHAINCRAFT_SPEC_PLAN_MODEL ||
    process.env.CHAINCRAFT_DESIGN_MODEL_NAME ||
    "",
  tracerProjectName:
    process.env.CHAINCRAFT_DESIGN_TRACER_PROJECT || "chaincraft-design",
};

/**
 * Default configuration for spec-execute agent
 */
const SPEC_EXECUTE_DEFAULTS = {
  modelName:
    process.env.CHAINCRAFT_SPEC_EXECUTE_MODEL ||
    process.env.CHAINCRAFT_DESIGN_MODEL_NAME ||
    "",
  tracerProjectName:
    process.env.CHAINCRAFT_DESIGN_TRACER_PROJECT || "chaincraft-design",
};

/**
 * Default configuration for narrative generation in specs
 */
const SPEC_NARRATIVE_DEFAULTS = {
  modelName:
    process.env.CHAINCRAFT_SPEC_NARRATIVE_MODEL ||
    process.env.CHAINCRAFT_DESIGN_MODEL_NAME ||
    "",
  tracerProjectName:
    process.env.CHAINCRAFT_DESIGN_TRACER_PROJECT || "chaincraft-design",
  maxTokens: 4000,
};

/**
 * Default configuration for spec-diff agent
 */
const SPEC_DIFF_DEFAULTS = {
  modelName:
    process.env.CHAINCRAFT_SPEC_DIFF_MODEL ||
    process.env.CHAINCRAFT_DESIGN_MODEL_NAME ||
    "",
  tracerProjectName:
    process.env.CHAINCRAFT_DESIGN_TRACER_PROJECT || "chaincraft-design",
};

/**
 * Default configuration for schema extraction
 * Falls back to SIMULATION_MODEL_NAME if not specified (override recommended with Sonnet)
 */
const SIM_SCHEMA_EXTRACTION_DEFAULTS = {
  modelName:
    process.env.CHAINCRAFT_SIM_SCHEMA_EXTRACTION_MODEL ||
    process.env.CHAINCRAFT_SIMULATION_MODEL_NAME ||
    "",
  tracerProjectName:
    process.env.CHAINCRAFT_SIMULATION_TRACER_PROJECT || "chaincraft-simulation",
};

/**
 * Default configuration for transition extraction
 * Uses SIMULATION_MODEL_NAME by default (Haiku 4.5 recommended for cost-effectiveness)
 */
const SIM_TRANSITIONS_EXTRACTION_DEFAULTS = {
  modelName:
    process.env.CHAINCRAFT_SPEC_TRANSITIONS_MODEL ||
    process.env.CHAINCRAFT_SIMULATION_MODEL_NAME ||
    "",
  tracerProjectName:
    process.env.CHAINCRAFT_SIMULATION_TRACER_PROJECT || "chaincraft-simulation",
};

/**
 * Default configuration for instructions planning extraction
 * Uses Sonnet 4.5 by default for high-quality planning
 */
const SIM_INSTRUCTIONS_DEFAULTS = {
  modelName:
    process.env.CHAINCRAFT_SIM_INSTRUCTIONS_MODEL ||
    process.env.CHAINCRAFT_SIMULATION_MODEL_NAME ||
    "",
  tracerProjectName:
    process.env.CHAINCRAFT_SIMULATION_TRACER_PROJECT || "chaincraft-simulation",
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
    tracerProjectName =
      options.tracerProjectName || DESIGN_DEFAULTS.tracerProjectName;
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
  const invoke = async (
    prompt: string,
    metadata?: Record<string, any>,
    schema?: any
  ): Promise<ModelResponse | any> => {
    const messages = [new HumanMessage(prompt)];
    const opts = createInvokeOptions(callbacks, metadata);

    if (schema) {
      return await invokeWithSchema(model, messages, opts, schema);
    }

    return (await model.invoke(prompt, opts)) as ModelResponse;
  };

  // Create invoke method that accepts full message history
  const invokeWithMessages = async (
    messages: BaseMessage[],
    metadata?: Record<string, any>,
    schema?: any
  ): Promise<ModelResponse | any> => {
    const opts = createInvokeOptions(callbacks, metadata);

    if (schema) {
      return await invokeWithSchema(model, messages, opts, schema);
    }

    const response = (await model.invoke(messages, opts)) as ModelResponse;
    
    // Log usage statistics
    logUsageStats(response?.response_metadata?.usage, metadata?.agent);
    
    return response;
  };

  // Create invoke method with explicit system prompt for completion-style tasks
  // Automatically detects and processes cache markers in templates
  const invokeWithSystemPrompt = async (
    systemPrompt: string,
    userPrompt?: string,
    metadata?: Record<string, any>,
    schema?: any
  ): Promise<ModelResponse | any> => {
    // Check if the prompt contains cache markers
    const hasCacheMarkers = /!___ CACHE:[\w-]+ ___!/.test(systemPrompt);
    
    let systemMessage: SystemMessage;
    if (hasCacheMarkers) {
      // Process template with cache markers
      systemMessage = createCachedSystemMessage(systemPrompt);
    } else {
      // Simple string system message (backwards compatible)
      systemMessage = new SystemMessage(systemPrompt);
    }
    
    const messages = [
      systemMessage,
      new HumanMessage(userPrompt || "Begin."),
    ];
    const opts = createInvokeOptions(callbacks, metadata);

    if (schema) {
      return await invokeWithSchema(model, messages, opts, schema);
    }

    const result = (await model.invoke(messages, opts)) as ModelResponse;
    
    // Log usage statistics
    logUsageStats(result?.response_metadata?.usage, metadata?.agent);
    
    return result;
  };

  const createInvocation = (
    metadata?: Record<string, any>,
    schema?: any
  ): InvocationBuilder => {
    return new InvocationBuilderImpl(invokeWithMessages, metadata, schema);
  };

  return {
    model,
    modelName,
    tracerProjectName,
    invokeOptions,
    invoke,
    invokeWithMessages,
    invokeWithSystemPrompt,
    createInvocation,
  };
};

/**
 * Helper: Create a setup function from defaults
 */
const createSetupFunction =
  (defaults: {
    modelName: string;
    tracerProjectName: string;
    maxTokens?: number;
  }) =>
  async (
    options: Omit<
      ModelConfigOptions,
      "useDesignDefaults" | "useSimulationDefaults"
    > = {}
  ): Promise<ModelWithOptions> => {
    return setupModel({
      modelName: options.modelName || defaults.modelName,
      tracerProjectName:
        options.tracerProjectName || defaults.tracerProjectName,
      maxTokens: options.maxTokens || defaults.maxTokens,
    });
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

export const setupConversationalAgentModel = createSetupFunction(
  CONVERSATIONAL_AGENT_DEFAULTS
);

/**
 * Setup model specifically for spec-plan agent
 * Uses Haiku by default for fast, cost-effective metadata extraction
 */
export const setupSpecPlanModel = createSetupFunction(SPEC_PLAN_DEFAULTS);

/**
 * Setup model specifically for spec-execute agent
 * Uses Sonnet by default for high-quality, comprehensive specification generation
 */
export const setupSpecExecuteModel = createSetupFunction(SPEC_EXECUTE_DEFAULTS);

/**
 * Setup model specifically for spec-diff agent
 * Uses Haiku by default for fast, cost-effective diff analysis
 */
export const setupSpecDiffModel = createSetupFunction(SPEC_DIFF_DEFAULTS);

/**
 * Setup model specifically for spec processing (schema extraction)
 * Uses Sonnet by default for high-quality schema generation with complex structured output
 * Haiku hits token limits with detailed schemas, so Sonnet is required
 */
export const setupSpecProcessingModel = createSetupFunction(
  SIM_SCHEMA_EXTRACTION_DEFAULTS
);

/**
 * Setup model specifically for transition extraction
 * Uses Haiku by default for cost-effective transition analysis
 */
export const setupSpecTransitionsModel = createSetupFunction(
  SIM_TRANSITIONS_EXTRACTION_DEFAULTS
);

/**
 * Setup model specifically for instruction extraction
 * Uses Sonnet by default for high-quality planning with high token limit
 */
export const setupSpecInstructionsModel = createSetupFunction(
  SIM_INSTRUCTIONS_DEFAULTS
);

/**
 * Setup model specifically for narrative generation
 * Uses Sonnet 4 by default for concise, high-quality narrative guidance with caching support
 */
export const setupNarrativeModel = createSetupFunction(SPEC_NARRATIVE_DEFAULTS);

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
  const allCallbacks = [...model.invokeOptions.callbacks, ...(callbacks || [])];

  const invokeOptions = {
    callbacks: allCallbacks,
    metadata: {
      ...metadata,
    },
  };

  return (await model.model.invoke(
    [new HumanMessage(prompt)],
    invokeOptions
  )) as ModelResponse;
};

/**
 * Helper: Create invoke options with callbacks and metadata
 */
const createInvokeOptions = (
  callbacks: any[],
  metadata?: Record<string, any>
) => ({
  callbacks,
  ...(metadata ? { metadata } : {}),
});

/**
 * Helper: Log usage statistics including cache metrics
 */
const logUsageStats = (usage: any, agent?: string) => {
  if (!usage || !agent) return;
  
  const inputTokens = usage.input_tokens || 0;
  const cacheCreation = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  
  console.log(`📊 [Model Usage] ${agent}`);
  console.log(`   Input tokens: ${inputTokens}`);
  console.log(`   Cache creation tokens: ${cacheCreation}`);
  console.log(`   Cache read tokens: ${cacheRead}`);
  console.log(`   Output tokens: ${outputTokens}`);
};

/**
 * Helper: Invoke model with structured output
 */
const invokeWithSchema = async (
  model: BaseChatModel,
  messages: BaseMessage[],
  invokeOptions: any,
  schema: any
) => {
  const structuredModel = (model as any).withStructuredOutput(schema, {
    maxTokens: 8192,
    includeRaw: true, // Get raw response with metadata
  });
  const result = await structuredModel.invoke(messages, invokeOptions);
  
  // withStructuredOutput with includeRaw returns {parsed, raw}
  // Log usage statistics
  logUsageStats(result?.raw?.response_metadata?.usage, invokeOptions?.metadata?.agent);
  
  // Return just the parsed result (maintain backward compatibility)
  return result?.parsed || result;
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

type CachedMessageContent = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

class InvocationBuilderImpl implements InvocationBuilder {
  private systemMessageContent: CachedMessageContent[] = [];
  private userMessage!: HumanMessage;

  constructor(
    private invokeFn: (
      messages: BaseMessage[],
      metadata?: Record<string, any>,
      schema?: any
    ) => Promise<ModelResponse | any>,
    private metadata?: Record<string, any>,
    private schema?: any
  ) {}

  addSystemPrompt(systemPrompt: string): InvocationBuilder {
    this.systemMessageContent.push({
      type: "text",
      text: systemPrompt,
    });
    return this;
  }

  addCachedSystemPrompt(systemPrompt: string): InvocationBuilder {
    this.systemMessageContent.push({
      type: "text",
      text: systemPrompt,
      cache_control: { type: "ephemeral" },
    });
    return this;
  }

  addUserPrompt(userPrompt: string): InvocationBuilder {
    this.userMessage = new HumanMessage(userPrompt);
    return this;
  }

  async invoke(): Promise<ModelResponse | any> {
    const messages: BaseMessage[] = [
      new SystemMessage({
        content: this.systemMessageContent,
      }),
      this.userMessage,
    ];
    return await this.invokeFn(messages, this.metadata, this.schema);
  }
}
