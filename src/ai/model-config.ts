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
 * Detect if running in test environment
 */
const isTest = process.env.NODE_ENV === 'test' || 
               process.env.JEST_WORKER_ID !== undefined ||
               process.argv.some(arg => arg.includes('jest'));



/**
 * Guidance automatically appended to system prompts when using structured output.
 * Helps prevent LLMs from stringifying JSON instead of returning proper structures.
 */
const STRUCTURED_OUTPUT_GUIDANCE = `

## CRITICAL: JSON Output Requirements
Your response MUST be valid JSON matching the provided schema.
- ALL fields must be proper JSON types (arrays, objects, strings, numbers, booleans)
- DO NOT wrap arrays or objects in quote strings
- DO NOT return stringified JSON (e.g., "[\\"item\\"]" is wrong, ["item"] is correct)

❌ WRONG (stringified array):
{
  "items": "[{\\"id\\": 1, \\"name\\": \\"foo\\"}]"
}

✅ CORRECT (actual array):
{
  "items": [{"id": 1, "name": "foo"}]
}

This applies to ALL nested structures - arrays of objects, objects containing arrays, etc.
`;

const DEFAULT_API_KEY = process.env.ANTHROPIC_API_KEY || "";

// New config structure
interface PhaseApiKeys {
  create: string;   // For design + spec processing
  sim: string;      // For simulation
  play: string;     // For gameplay execution
}

// Environment variables or config
const PHASE_API_KEYS: PhaseApiKeys = {
  // Use not null assertions to indicate these must be set and produce a runtime
  // error if missing.
  create: process.env.ANTHROPIC_API_KEY_CREATE || process.env.ANTHROPIC_API_KEY!,
  sim: process.env.ANTHROPIC_API_KEY_SIM || process.env.ANTHROPIC_API_KEY!,
  play: process.env.ANTHROPIC_API_KEY_PLAY || process.env.ANTHROPIC_API_KEY!,
};

/**
 * Model setup result interface
 */
export interface ModelWithOptions {
  model: BaseChatModel;
  modelName: string;
  tracerProjectName?: string;
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
  /**
   * Get tracer callbacks for passing to LangGraph subgraph invocations
   * @returns Tracer callback array
   */
  getCallbacks: () => any[];
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
  maxTokens?: number;
  apiKey?: string;
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
    process.env.CHAINCRAFT_DESIGN_TRACER_PROJECT_NAME || "chaincraft-design",
  apiKey: PHASE_API_KEYS.create,
};

/**
 * Default configuration for simulation workflows
 */
const SIMULATION_DEFAULTS = {
  modelName: process.env.CHAINCRAFT_SIMULATION_MODEL_NAME || "",
  tracerProjectName:
    process.env.CHAINCRAFT_SIMULATION_TRACER_PROJECT_NAME || "chaincraft-simulation",
  apiKey: PHASE_API_KEYS.sim,
};

/**
 * Default configuration for conversational agent
 */
const CONVERSATIONAL_AGENT_DEFAULTS = {
  ...DESIGN_DEFAULTS,
  modelName:
    process.env.CHAINCRAFT_CONVERSATIONAL_AGENT_MODEL ||
    process.env.CHAINCRAFT_DESIGN_MODEL_NAME ||
    ""
};

/**
 * Default configuration for spec-plan agent
 */
const SPEC_PLAN_DEFAULTS = {
  ...DESIGN_DEFAULTS,
  modelName:
    process.env.CHAINCRAFT_SPEC_PLAN_MODEL ||
    process.env.CHAINCRAFT_DESIGN_MODEL_NAME ||
    "",
};

/**
 * Default configuration for spec-execute agent
 */
const SPEC_EXECUTE_DEFAULTS = {
  ...DESIGN_DEFAULTS,
  modelName:
    process.env.CHAINCRAFT_SPEC_EXECUTE_MODEL ||
    process.env.CHAINCRAFT_DESIGN_MODEL_NAME ||
    "",
};

/**
 * Default configuration for narrative generation in specs
 */
const SPEC_NARRATIVE_DEFAULTS = {
  ...DESIGN_DEFAULTS,
  modelName:
    process.env.CHAINCRAFT_SPEC_NARRATIVE_MODEL ||
    process.env.CHAINCRAFT_DESIGN_MODEL_NAME ||
    "",
  maxTokens: 4000,
};

/**
 * Default configuration for spec-diff agent
 */
const SPEC_DIFF_DEFAULTS = {
  ...DESIGN_DEFAULTS,
  modelName:
    process.env.CHAINCRAFT_SPEC_DIFF_MODEL ||
    process.env.CHAINCRAFT_DESIGN_MODEL_NAME ||
    "",
};

/**
 * Default configuration for artifact creation.  This happens in the sim flow, but
 * we want to track using the create key, since it is conceptually part of the 
 * design/build phase.
 */
const ARTIFACT_CREATION_DEFAULTS = {
  modelName: process.env.CHAINCRAFT_SIMULATION_MODEL_NAME || "",
  tracerProjectName:
    process.env.CHAINCRAFT_ARTIFACT_CREATION_TRACER_PROJECT_NAME || "chaincraft-simulation",
  apiKey: PHASE_API_KEYS.create,
};

/**
 * Default configuration for schema extraction
 * Falls back to SIMULATION_MODEL_NAME if not specified (override recommended with Sonnet)
 */
const SIM_SCHEMA_EXTRACTION_DEFAULTS = {
  ...ARTIFACT_CREATION_DEFAULTS,
  modelName:
    process.env.CHAINCRAFT_SIM_SCHEMA_EXTRACTION_MODEL ||
    process.env.CHAINCRAFT_SIMULATION_MODEL_NAME ||
    "",
};

/**
 * Default configuration for transition extraction
 * Uses SIMULATION_MODEL_NAME by default (Haiku 4.5 recommended for cost-effectiveness)
 */
const SIM_TRANSITIONS_EXTRACTION_DEFAULTS = {
  ...ARTIFACT_CREATION_DEFAULTS,
  modelName:
    process.env.CHAINCRAFT_SPEC_TRANSITIONS_MODEL ||
    process.env.CHAINCRAFT_SIMULATION_MODEL_NAME ||
    "",
};

/**
 * Default configuration for instructions planning extraction
 * Uses Sonnet 4.5 by default for high-quality planning
 */
const SIM_INSTRUCTIONS_DEFAULTS = {
  ...ARTIFACT_CREATION_DEFAULTS,
  modelName:
    process.env.CHAINCRAFT_SIM_INSTRUCTIONS_MODEL ||
    process.env.CHAINCRAFT_SIMULATION_MODEL_NAME ||
    "",
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
  const modelName = options.modelName;
  const tracerProjectName = options.tracerProjectName;
  const apiKey = options.apiKey;

  if (!modelName) {
    throw new Error(
      "Model name must be provided either through options or environment variables"
    );
  }

  const model = await getModel(modelName, options.maxTokens, apiKey);

  // Create tracer callbacks based on configuration (created once, reused for all invocations)
  const callbacks = createTracerCallbacks(tracerProjectName);

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
    // If schema is provided, append structured output guidance to system prompt
    if (schema) {
      systemPrompt = systemPrompt + STRUCTURED_OUTPUT_GUIDANCE;
    }
    
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
    invoke,
    invokeWithMessages,
    invokeWithSystemPrompt,
    createInvocation,
    // Expose callbacks for LangGraph subgraph invocations
    getCallbacks: () => callbacks,
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
    apiKey?: string;
  }) =>
  async (options: ModelConfigOptions = {}): Promise<ModelWithOptions> => {
    const finalTracerProjectName = options.tracerProjectName || defaults.tracerProjectName;
    return setupModel({
      modelName: options.modelName || defaults.modelName,
      tracerProjectName: finalTracerProjectName,
      apiKey: options.apiKey || defaults.apiKey,
      maxTokens: options.maxTokens || defaults.maxTokens,
    });
  };

/**
 * Setup model specifically for discovery workflows
 * @param options Optional configuration overrides
 * @returns Promise resolving to ModelSetup configured for discovery
 */
export const setupDesignModel = async (
  options: ModelConfigOptions = {}
): Promise<ModelWithOptions> => {
  return setupModel({
    modelName: options.modelName || DESIGN_DEFAULTS.modelName,
    tracerProjectName: options.tracerProjectName || DESIGN_DEFAULTS.tracerProjectName,
    apiKey: options.apiKey || DESIGN_DEFAULTS.apiKey,
    maxTokens: options.maxTokens,
  });
};

/**
 * Setup model specifically for simulation workflows
 * @param options Optional configuration overrides
 * @returns Promise resolving to ModelSetup configured for simulation
 */
export const setupSimulationModel = async (
  options: ModelConfigOptions = {}
): Promise<ModelWithOptions> => {
  const tracerProjectName = options.tracerProjectName || SIMULATION_DEFAULTS.tracerProjectName;
  
  return setupModel({
    modelName: options.modelName || SIMULATION_DEFAULTS.modelName,
    tracerProjectName,
    apiKey: options.apiKey || SIMULATION_DEFAULTS.apiKey,
    maxTokens: options.maxTokens,
  });
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
export const setupSpecSchemaModel = createSetupFunction(
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
  // Merge the configured callbacks with any additional callbacks
  const allCallbacks = [...model.getCallbacks(), ...(callbacks || [])];

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
) => {
  console.log('[createInvokeOptions] callbacks:', callbacks);
  console.log('[createInvokeOptions] callbacks[0]?.projectName:', (callbacks?.[0] as any)?.projectName);
  return {
    callbacks,
    ...(metadata ? { metadata } : {}),
  };
};

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
    includeRaw: true, // Get raw response with metadata
  });
  const result = await structuredModel.invoke(messages, invokeOptions);
  
  // withStructuredOutput with includeRaw returns {parsed, raw}
  // Log usage statistics
  logUsageStats(result?.raw?.response_metadata?.usage, invokeOptions?.metadata?.agent);
  
  // Check if validation failed (parsed is null when Zod validation fails)
  if (result?.parsed === null || result?.parsed === undefined) {
    // Extract raw content for debugging
    const rawContent = result?.raw?.content;
    let contentText = "Unable to extract raw content";
    
    if (Array.isArray(rawContent) && rawContent.length > 0) {
      // Anthropic format: content is array of blocks
      const toolUse = rawContent.find((block: any) => block.type === "tool_use");
      if (toolUse?.input) {
        contentText = JSON.stringify(toolUse.input, null, 2);
      }
    } else if (typeof rawContent === "string") {
      contentText = rawContent;
    }
    
    const agent = invokeOptions?.metadata?.agent || "unknown";
    
    throw new Error(
      `Structured output validation failed for agent '${agent}'.\n` +
      `The LLM response did not match the required schema.\n\n` +
      `Raw LLM output:\n${contentText}\n\n` +
      `This typically means:\n` +
      `- A field has the wrong type (e.g., string instead of array, or vice versa)\n` +
      `- A required field is missing\n` +
      `- A field contains invalid values\n\n` +
      `Check LangSmith trace for detailed Zod validation errors.`
    );
  }
  
  // Return just the parsed result (maintain backward compatibility)
  return result.parsed;
};

/**
 * Create callbacks array with tracer project name if provided
 * Automatically appends -test suffix when running in test environment
 * @param tracerProjectName Optional tracer project name for tracing
 * @returns Array of callbacks for model invocation
 */
export const createTracerCallbacks = (tracerProjectName?: string): any[] => {
  console.log('[createTracerCallbacks] Called with tracerProjectName:', tracerProjectName);
  console.log('[createTracerCallbacks] isTest:', isTest);
  console.log('[createTracerCallbacks] NODE_ENV:', process.env.NODE_ENV);
  console.log('[createTracerCallbacks] LANGCHAIN_PROJECT env var:', process.env.LANGCHAIN_PROJECT);
  
  if (!tracerProjectName) {
    console.log('[createTracerCallbacks] WARNING: No tracer project name, returning empty array - will use LangSmith default');
    return [];
  }

  // Auto-append -test suffix when running in test environment (unless already present)
  const finalProjectName = isTest && !tracerProjectName.includes('-test')
    ? `${tracerProjectName}-test`
    : tracerProjectName;

  console.log('[createTracerCallbacks] Creating LangChainTracer with project:', finalProjectName);
  console.log('[createTracerCallbacks] LANGSMITH_API_KEY exists:', !!process.env.LANGSMITH_API_KEY);
  console.log('[createTracerCallbacks] LANGSMITH_ENDPOINT:', process.env.LANGSMITH_ENDPOINT);

  // Create LangChain tracer with explicit configuration
  const tracer = new LangChainTracer({
    projectName: finalProjectName,
    // Explicitly pass endpoint and API key to ensure they're used
    ...(process.env.LANGSMITH_ENDPOINT && { endpoint: process.env.LANGSMITH_ENDPOINT }),
    ...(process.env.LANGSMITH_API_KEY && { apiKey: process.env.LANGSMITH_API_KEY }),
  });

  console.log('[createTracerCallbacks] Tracer created with name:', tracer.name);
  console.log('[createTracerCallbacks] Tracer projectName property:', (tracer as any).projectName);

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
