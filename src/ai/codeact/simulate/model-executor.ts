/**
 * Model-driven execution engine for simulation using the CodeAct methodology.
 * 
 * This module implements the CodeAct approach where:
 * 1. The AI model is provided with function documentation
 * 2. AI writes code that uses available functions to process game events
 * 3. This code is executed in a sandbox environment
 * 4. Results are used to update the game state
 */

import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { FunctionRegistry, FunctionDefinition } from "../function-registry.js";
import { GameCodeSandbox, SandboxExecutionResult } from "../sandbox/sandbox.js";
import { 
  createInitGamePrompt,
  createProcessActionPrompt,
  createErrorRecoveryPrompt
} from "./prompt-templates.js";

export interface ExecutionContext {
  currentState: any;
  gameSpecification: string;
  playerIds?: string[];
  codeImplementations: {
    initializeGame?: string;
    processAction?: string;
  };
  history: {
    action: string;
    playerId: string;
    timestamp: string;
    publicMessage?: string;
    privateMessages: Record<string, string>;
    stateAfter: any;
  }[];
  // Add generatedCode tracking to store code history
  codeHistory: {
    timestamp: string;
    operation: 'initialize' | 'process' | 'recover';
    code: string;
    executionResult: {
      success: boolean;
      error?: string;
      executionTime: number;
    };
  }[];
}

export interface SimulationResult {
  state: any;
  messages: {
    public: string[];
    private: Record<string, string[]>;
  };
}

export interface ModelExecutorOptions {
  model: BaseChatModel;
  functionRegistry: FunctionRegistry;
  gameSpecification: string;
  stateDefinition?: string;
  initialState?: any;
}

/**
 * Create a new execution context
 * @param options Model executor options
 * @returns A new execution context
 */
export function createExecutionContext(options: ModelExecutorOptions): ExecutionContext {
  return {
    currentState: options.initialState || {},
    gameSpecification: options.gameSpecification,
    history: [],
    codeHistory: [],
    codeImplementations: {
      initializeGame: '',
      processAction: ''
    },
  };
}

/**
 * Initialize a new game state using the AI model
 * 
 * @param context The execution context
 * @param options The model executor options
 * @returns The initialized game state
 */
export async function initializeGame(
  context: ExecutionContext,
  options: ModelExecutorOptions
): Promise<SimulationResult> {
  console.log('[ModelExecutor] Initializing game state with model: ' + options.model.constructor.name);
  
  // Generate initialize function first if needed
  if (!context.codeImplementations.initializeGame) {
    await generateInitializeFunction(context, options);
  }
  
  const playerIds = context.playerIds || [];
  if (playerIds.length < 1) {
    throw new Error('Cannot initialize game: no player IDs provided');
  }
  
  console.log('[ModelExecutor] Executing initializeGame with player IDs:', playerIds);
  
  // Format the AI-generated function for execution
  const aiGeneratedCode = context.codeImplementations.initializeGame;
  if (!aiGeneratedCode) {
    throw new Error('No AI-generated code found for initializeGame');
  }
  const functionBody = ensureFunctionBody(aiGeneratedCode, 'ai_initializeGame');
  
  // Wrap the function body in a complete function that we can execute
  const executableCode = `
    ${functionBody}
    
    return ai_initializeGame(playerIds, gameSpec);
  `;
  
  // Log the generated code before execution
  const codeTimestamp = new Date().toISOString();
  
  // Create the sandbox for executing the code
  const sandbox = new GameCodeSandbox({ 
    debugMode: true 
  });
  
  const unsafeFunctions = options.functionRegistry.getAllFunctions();

  // For now, treat all functions as unsafe as we don't have explicit safe function list yet
  // In future, you might want to explicitly define which functions are safe
  for (const funcDef of unsafeFunctions) {
    sandbox.registerUnsafeFunction(funcDef);
  }

  // Execute the code in the sandbox
  const executionResult = await sandbox.execute(
    executableCode,
    [{
      playerIds,
      gameSpec: options.gameSpecification
    }],
    { timeoutMs: 10000 }
  );
  
  // Add code to history with execution result
  context.codeHistory.push({
    timestamp: codeTimestamp,
    operation: 'initialize',
    code: aiGeneratedCode,
    executionResult: {
      success: executionResult.error === null,
      error: executionResult.error || undefined,
      executionTime: executionResult.executionTime
    }
  });
  
  if (executionResult.error) {
    console.error('[ModelExecutor] Initialization error:', executionResult.error);
    return await recoverFromError(
      context, options, 'initialize', playerIds, executionResult.error, null
    );
  }
  
  // Parse and validate the result
  try {
    return validateAndFormatResult(executionResult.result);
  } catch (error) {
    console.error('[ModelExecutor] Result validation error:', error);
    
    // Attempt recovery for validation errors
    if (error instanceof Error) {
      return await recoverFromError(
        context, options, 'initialize', playerIds, error.message, null
      );
    }
    throw error;
  }
}

/**
 * Generates or retrieves the initializeGame function implementation
 * 
 * @param context The execution context
 * @param options The model executor options
 * @returns Promise resolving when the function is available
 */
async function generateInitializeFunction(
  context: ExecutionContext,
  options: ModelExecutorOptions
): Promise<void> {
  console.log('[ModelExecutor] Generating initialize function with model');
  
  // Check if we already have cached implementation
  if (context.codeImplementations.initializeGame) {
    console.log('[ModelExecutor] Using existing initialize implementation');
    return;
  }
  
  // Get function documentation from registry
  const functionDocs = options.functionRegistry.getAllFunctions()
    .map((fn: FunctionDefinition) => `${fn.signature}\n${fn.description}`)
    .join('\n\n');
  
  // Prepare the prompt for the model using the imported prompt template function
  const prompt = createInitGamePrompt({
    gameSpecification: options.gameSpecification,
    functionDocumentation: functionDocs,
    playerIds: context.playerIds || []
  });
  
  try {
    // Get the implementation from the model
    const response = await options.model.invoke(prompt);
    const aiGeneratedCode = extractCodeFromResponse(response.content as string, 'initializeGame');
    
    if (!aiGeneratedCode) {
      throw new Error('Failed to extract initialize game code from model response');
    }
    
    // Store the implementation in context
    context.codeImplementations.initializeGame = aiGeneratedCode;
    console.log('[ModelExecutor] Successfully generated initialize implementation');
  } catch (error) {
    console.error('[ModelExecutor] Failed to generate initialize implementation', error);
    throw new Error(`Failed to generate initialize function: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Process a player action within the game.
 * Uses the CodeAct methodology to have the AI generate code that processes the action.
 * 
 * @param context The execution context
 * @param options The model executor options
 * @param playerId The ID of the player taking the action
 * @param action The action being taken by the player
 * @returns The result of processing the action
 */
export async function processAction(
  context: ExecutionContext,
  options: ModelExecutorOptions,
  playerId: string,
  action: string
): Promise<SimulationResult> {
  console.log(`[ModelExecutor] Processing action for player ${playerId}: ${action}`);
  
  // Generate process function if needed
  if (!context.codeImplementations.processAction) {
    await generateProcessActionFunction(context, options, playerId, action);
  }

  // Store the current function implementation
  const aiGeneratedCode = context.codeImplementations.processAction;
  if (!aiGeneratedCode) {
    throw new Error('No AI-generated code found for processAction');
  }

  // Format the function for execution
  const functionBody = ensureFunctionBody(aiGeneratedCode, 'ai_processAction');
  
  // Wrap the function body for execution
  const executableCode = `
    ${functionBody}
    
    return ai_processAction(playerId, action, currentState, gameSpec);
  `;
  
  // Log the generated code before execution
  const codeTimestamp = new Date().toISOString();
  
  // Create the sandbox for executing the code
  const sandbox = new GameCodeSandbox({ 
    debugMode: true 
  });
  
  // Execute the code in the sandbox
  const executionResult = await sandbox.execute(
    executableCode,
    [{
      playerId,
      action,
      currentState: { ...context.currentState },
    }],
    { timeoutMs: 5000 }
  );
  
  // Add code to history with execution result
  context.codeHistory.push({
    timestamp: codeTimestamp,
    operation: 'process',
    code: aiGeneratedCode,
    executionResult: {
      success: executionResult.error === null,
      error: executionResult.error || undefined,
      executionTime: executionResult.executionTime
    }
  });
  
  if (executionResult.error) {
    console.error('[ModelExecutor] Error executing action processing code:', executionResult.error);
    
    // Try again with error context
    return await recoverFromError(
      context,
      options,
      'process',
      playerId,
      executionResult.error,
      action
    );
  }
  
  // Parse and validate the execution result
  const result = validateAndFormatResult(executionResult.result);
  
  // Update current state
  context.currentState = result.state;
  
  // Add to history
  context.history.push({
    action,
    playerId,
    timestamp: new Date().toISOString(),
    publicMessage: result.messages.public[0],
    privateMessages: Object.fromEntries(
      Object.entries(result.messages.private).map(([id, msgs]) => [id, msgs[0] || ''])
    ),
    stateAfter: { ...context.currentState }
  });
  
  return result;
}

/**
 * Generates or retrieves the processAction function implementation
 * 
 * @param context The execution context
 * @param options The model executor options
 * @returns Promise resolving when the function is available
 */
async function generateProcessActionFunction(
  context: ExecutionContext,
  options: ModelExecutorOptions,
  playerId: string,
  action: string
): Promise<void> {
  console.log('[ModelExecutor] Generating process action function with model');
  
  // Check if we already have cached implementation
  if (context.codeImplementations.processAction) {
    console.log('[ModelExecutor] Using existing process action implementation');
    return;
  }
  
  // Get function documentation from registry
  const functionDocs = options.functionRegistry.getAllFunctions()
    .map((fn: FunctionDefinition) => `${fn.signature}\n${fn.description}`)
    .join('\n\n');
  
  // Get the current state to provide as context
  const currentStateJson = JSON.stringify(context.currentState, null, 2);
  
  // Prepare the prompt for the model using the imported prompt template function
  const prompt = createProcessActionPrompt({
    gameSpecification: '',
    functionDocumentation: functionDocs,
    currentState: currentStateJson,
    playerId: playerId,
    action: action || '',
  });
  
  try {
    // Get the implementation from the model
    const response = await options.model.invoke(prompt);
    const aiGeneratedCode = extractCodeFromResponse(response.content as string, 'processAction');
    
    if (!aiGeneratedCode) {
      throw new Error('Failed to extract process action code from model response');
    }
    
    // Store the implementation in context
    context.codeImplementations.processAction = aiGeneratedCode;
    console.log('[ModelExecutor] Successfully generated process action implementation');
  } catch (error) {
    console.error('[ModelExecutor] Failed to generate process action implementation', error);
    throw new Error(`Failed to generate process action function: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Attempt to recover from an error by asking the model to fix the generated code
 * 
 * @param context The execution context
 * @param options The model executor options
 * @param operation The operation that failed ('initialize' or 'process')
 * @param idOrAction The player ID or action that was being processed
 * @param errorMessage The error message that occurred
 * @param actionText The action text (if processing an action)
 * @returns The result after recovery attempt
 */
async function recoverFromError(
  context: ExecutionContext,
  options: ModelExecutorOptions,
  operation: 'initialize' | 'process',
  idOrAction: string | string[],
  errorMessage: string,
  actionText: string | null
): Promise<SimulationResult> {
  console.log(`[ModelExecutor] Attempting to recover from error in ${operation} operation`);
  
  // Get function documentation from registry
  const functionDocs = options.functionRegistry.getAllFunctions()
    .map((fn: FunctionDefinition) => `${fn.signature}\n${fn.description}`)
    .join('\n\n');
  
  // Create prompt for error recovery
  const prompt = createErrorRecoveryPrompt({
    gameSpecification: '',
    functionDocumentation: functionDocs,
    errorMessage,
    operation,
    playerId: Array.isArray(idOrAction) ? 'multiple' : idOrAction,
    playerIds: Array.isArray(idOrAction) ? idOrAction : undefined,
    action: actionText,
    currentState: JSON.stringify(context.currentState, null, 2)
  });
  
  // Determine which function name to look for based on operation
  const functionName = operation === 'initialize' ? 'initializeGame' : 'processAction';
  
  // Ask the model to generate fixed code
  const response = await options.model.invoke(prompt);
  const aiGeneratedCode = extractCodeFromResponse(response.content as string, functionName);
  
  if (!aiGeneratedCode) {
    throw new Error(`Failed to generate error recovery code: ${errorMessage}`);
  }
  
  // Wrap code with direct return instead of SANDBOX_RESULT pattern
  const executableCode = operation === 'initialize' 
    ? `
      ${aiGeneratedCode}
      
      // Call the AI-generated function and return its result directly
      return ai_initializeGame(playerIds, gameSpec);
    `
    : `
      ${aiGeneratedCode}
      
      // Call the AI-generated function and return its result directly
      return ai_processAction(playerId, action, currentState, gameSpec);
    `;
  
  console.log('[ModelExecutor] Executing error recovery code in sandbox');
  
  // Log the generated code before execution
  const codeTimestamp = new Date().toISOString();
  
  // Prepare the execution arguments
  const executionArgs = operation === 'initialize' 
    ? [{
        playerIds: idOrAction, 
        gameSpec: ''
      }]
    : [{
        playerId: idOrAction as string,
        action: actionText,
        currentState: { ...context.currentState },
        gameSpec: ''
      }];
  
  // Create the sandbox for executing the code
  const sandbox = new GameCodeSandbox({ 
    debugMode: true 
  });
  
  // Execute the wrapped code in the sandbox
  const executionResult = await sandbox.execute(
    executableCode,
    executionArgs,
    { timeoutMs: 10000 }
  );
  
  // Add code to history with execution result
  context.codeHistory.push({
    timestamp: codeTimestamp,
    operation: 'recover',
    code: aiGeneratedCode,
    executionResult: {
      success: executionResult.error === null,
      error: executionResult.error || undefined,
      executionTime: executionResult.executionTime
    }
  });
  
  if (executionResult.error) {
    console.error('[ModelExecutor] Error recovery failed:', executionResult.error);
    throw new Error(`Error recovery failed: ${executionResult.error}`);
  }
  
  // Parse and validate the result
  return validateAndFormatResult(executionResult.result);
}

/**
 * Extract code from the model's response and adapt it for execution
 * @param response The model's response text
 * @param functionName The expected function name to extract (without ai_ prefix)
 * @returns The extracted code adapted for sandbox execution or null if not found
 */
function extractCodeFromResponse(response: string, functionName: string): string | null {
  // Add AI prefix to the function name
  const aiFunctionName = `ai_${functionName}`;
  
  // Extract code block from markdown response
  const codeBlockRegex = /```(?:javascript|js)?\s*([\s\S]*?)\s*```/;
  const match = response.match(codeBlockRegex);
  
  if (!match || !match[1]) {
    // If no code block found but there's JS-like content, try to use the whole response
    if (response.includes('function') || response.includes('const') || response.includes('let')) {
      console.log('[extractCodeFromResponse] No code block found, using raw response');
      return wrapCodeWithFunctionSignature(response, aiFunctionName, functionName);
    }
    return null;
  }
  
  const extractedCode = match[1].trim();
  
  // First, check if the code already contains a function declaration with the expected name
  const functionRegex = new RegExp(`function\\s+${aiFunctionName}\\s*\\([^)]*\\)\\s*{([\\s\\S]*?)}`);
  const functionMatch = extractedCode.match(functionRegex);
  
  if (functionMatch) {
    // AI provided the full function definition
    console.log('[extractCodeFromResponse] Found complete function definition in response');
    return extractedCode;
  } else {
    // AI only provided the function body as instructed
    // We need to wrap it with the proper function signature
    console.log('[extractCodeFromResponse] Function definition not found, wrapping code with function signature');
    return wrapCodeWithFunctionSignature(extractedCode, aiFunctionName, functionName);
  }
}

/**
 * Wrap the code with the appropriate function signature based on the function name
 * @param code The code to wrap (function body)
 * @param aiFunctionName The AI-specific function name (with ai_ prefix)
 * @param baseFunctionName The base function name (without prefix)
 * @returns The wrapped code with proper function signature
 */
function wrapCodeWithFunctionSignature(code: string, aiFunctionName: string, baseFunctionName: string): string {
  // Define the appropriate function signature based on the function name
  let functionSignature: string;
  
  if (baseFunctionName === 'initializeGame') {
    functionSignature = `function ${aiFunctionName}(playerIds, gameSpec) {`;
  } else if (baseFunctionName === 'processAction') {
    functionSignature = `function ${aiFunctionName}(playerId, action, currentState, gameSpec) {`;
  } else {
    // Generic fallback signature
    functionSignature = `function ${aiFunctionName}(args) {`;
  }
  
  // Ensure the code is indented properly for readability
  const indentedCode = code
    .split('\n')
    .map(line => `  ${line}`)
    .join('\n');
  
  // If the code doesn't end with a return statement, add a warning comment
  const hasReturn = /return\s+[\s\S]*?;/.test(code);
  const returnWarning = !hasReturn ? 
    '\n  // WARNING: No return statement found in function body\n' : '';
  
  // Construct the complete function
  const wrappedCode = `${functionSignature}\n${indentedCode}${returnWarning}\n}`;
  
  console.log('[wrapCodeWithFunctionSignature] Generated function:', wrappedCode.substring(0, 100) + '...');
  
  return wrappedCode;
}

/**
 * Ensures that the provided code has the expected function signature
 * 
 * @param code The AI-generated code
 * @param expectedFunctionName The expected function name in the code
 * @returns Code with the proper function signature
 */
function ensureFunctionBody(code: string, expectedFunctionName: string): string {
  // Check if the code already contains the function definition
  const functionRegex = new RegExp(`function\\s+${expectedFunctionName}\\s*\\([^)]*\\)\\s*{`);
  
  if (functionRegex.test(code)) {
    // Code already has the function definition
    return code;
  }
  
  // Determine appropriate function signature based on function name
  let functionSignature: string;
  
  if (expectedFunctionName === 'ai_initializeGame') {
    functionSignature = `function ${expectedFunctionName}(playerIds, gameSpec) {`;
  } else if (expectedFunctionName === 'ai_processAction') {
    functionSignature = `function ${expectedFunctionName}(playerId, action, currentState, gameSpec) {`;
  } else {
    // Generic fallback
    functionSignature = `function ${expectedFunctionName}(args) {`;
  }
  
  // Indent the code to fit inside the function
  const indentedCode = code
    .split('\n')
    .map(line => `  ${line}`)
    .join('\n');
  
  // Return the complete function definition
  return `${functionSignature}\n${indentedCode}\n}`; 
}

/**
 * Validate and format the execution result
 * @param result The raw execution result
 * @returns A properly formatted simulation result
 */
function validateAndFormatResult(result: any): SimulationResult {
  // Handle case where result might be wrapped in another object
  const actualResult = result && result.result ? result.result : result;
  
  // Create a properly structured result
  const formattedResult: SimulationResult = {
    state: actualResult?.state || {},
    messages: {
      public: [],
      private: {}
    }
  };
  
  // Handle messages
  if (actualResult?.messages) {
    // Public messages
    if (actualResult.messages.public) {
      formattedResult.messages.public = Array.isArray(actualResult.messages.public)
        ? actualResult.messages.public
        : [actualResult.messages.public];
    }
    
    // Private messages
    if (actualResult.messages.private) {
      const privateMessages = actualResult.messages.private;
      formattedResult.messages.private = {};
      
      Object.keys(privateMessages).forEach(playerId => {
        const messages = privateMessages[playerId];
        formattedResult.messages.private[playerId] = Array.isArray(messages)
          ? messages
          : [messages];
      });
    }
  }
  
  return formattedResult;
}

/**
 * Get the current game state.
 * @param context The execution context
 * @returns The current game state
 */
export function getGameState(context: ExecutionContext): any {
  return { ...context.currentState };
}

/**
 * Get the game history.
 * @param context The execution context
 * @returns The game history
 */
export function getHistory(context: ExecutionContext): ExecutionContext['history'] {
  return [...context.history];
}

/**
 * Get the code generation history.
 * @param context The execution context
 * @returns The code history
 */
export function getCodeHistory(context: ExecutionContext): ExecutionContext['codeHistory'] {
  return [...context.codeHistory];
}

/**
 * Get the most recently generated code.
 * @param context The execution context
 * @returns The most recent code entry or null if none exists
 */
export function getLastGeneratedCode(context: ExecutionContext): ExecutionContext['codeHistory'][0] | null {
  if (context.codeHistory.length === 0) {
    return null;
  }
  return context.codeHistory[context.codeHistory.length - 1];
}