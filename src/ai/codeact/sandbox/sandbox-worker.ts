/**
 * sandbox-worker.ts
 * 
 * This worker handles execution of code in a sandboxed environment.
 * It runs in a separate thread from the main application, which allows for:
 * - Proper timeout handling of synchronous infinite loops
 * - Parallel execution of multiple sandboxes across CPU cores
 * - Isolation of execution environments
 */

import { parentPort } from 'worker_threads';
import safeFunctions from './safe-functions.js';

// Type definition for an unsafe function
type UnsafeFunctionDefinition = {
  name: string;
  impl: string;
  code?: string;
  signature?: string;
  description?: string;
};

// Base interface for all worker messages
interface BaseWorkerMessage {
  requestId: number;
}

// Messages sent from sandbox to worker
interface InitMessage extends BaseWorkerMessage {
  type: 'init';
  debugMode?: boolean;
  unsafeFunctions?: UnsafeFunctionDefinition[];
}

interface RegisterMessage extends BaseWorkerMessage {
  type: 'register';
  function: UnsafeFunctionDefinition;
}

interface ExecuteMessage extends BaseWorkerMessage {
  type: 'execute';
  code: string;
  context?: Record<string, any>;
  timeoutMs?: number;
}

interface TerminateMessage extends BaseWorkerMessage {
  type: 'terminate';
}

// Union type for all inbound messages
type WorkerMessage = InitMessage | RegisterMessage | ExecuteMessage | TerminateMessage;

// Base interface for all worker responses
interface BaseWorkerResponse {
  requestId: number;
}

// Messages sent from worker to sandbox
interface ReadyResponse extends BaseWorkerResponse {
  type: 'ready';
}

interface RegisterResultResponse extends BaseWorkerResponse {
  type: 'result';
  operation: 'register';
  functionName: string;
  success: boolean;
  error?: string | null;
}

interface ExecuteResultResponse extends BaseWorkerResponse {
  type: 'result';
  operation: 'execute';
  result: any;
  error: string | null;
  executionTime: number;
}

interface ErrorResponse extends BaseWorkerResponse {
  type: 'error';
  message: string;
  stack?: string;
}

// Union type for all outbound messages
type WorkerResponse = ReadyResponse | RegisterResultResponse | ExecuteResultResponse | ErrorResponse;

// Special case for uncaught exceptions which don't have requestId
interface UncaughtExceptionResponse {
  type: 'error';
  message: string;
  stack?: string;
}

// Debug mode flag
let debugMode = false;

// Store registered unsafe functions
const unsafeFunctions = new Map<string, UnsafeFunctionDefinition>();

// Check if the parent port exists (should always be the case in a worker)
if (!parentPort) {
  console.error('This script must be run as a worker thread!');
  process.exit(1);
}

/**
 * Register an unsafe function that can be called from within the sandbox
 * Now returns validation results instead of void
 */
function registerUnsafeFunction(funcDef: UnsafeFunctionDefinition): { success: boolean; error?: string } {
  // Validate required properties
  if (!funcDef.name || typeof funcDef.name !== 'string' || funcDef.name.trim() === '') {
    return {
      success: false,
      error: 'Function name is required and must be a non-empty string'
    };
  }

  if (!funcDef.impl || typeof funcDef.impl !== 'string' || funcDef.impl.trim() === '') {
    return {
      success: false,
      error: 'Function implementation (impl) is required and must be a non-empty string'
    };
  }

  // Check for duplicate function names
  if (unsafeFunctions.has(funcDef.name)) {
    return {
      success: false,
      error: `Function '${funcDef.name}' is already registered`
    };
  }

  // Validate function name format (basic identifier check)
  const validNamePattern = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
  if (!validNamePattern.test(funcDef.name)) {
    return {
      success: false,
      error: `Function name '${funcDef.name}' is not a valid JavaScript identifier`
    };
  }

  try {
    // Test that the implementation code can be compiled into a function
    // This catches basic syntax errors during registration
    new Function('args', funcDef.impl);
    
    // If we get here, the function compiled successfully
    if (debugMode) {
      console.log(`[SandboxWorker] Registered unsafe function: ${funcDef.name}`);
    }

    // Store the function definition
    unsafeFunctions.set(funcDef.name, funcDef);

    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: `Function implementation has syntax error: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Execute code in the sandbox with provided context
 */
async function executeCode(
  code: string, 
  context: Record<string, any> = {},
  options: { timeoutMs?: number } = {}
): Promise<{ result: any; error: string | null; executionTime: number }> {
  const startTime = Date.now();
  const timeout = options.timeoutMs || 5000;

  try {
    if (debugMode) {
      console.log(`[SandboxWorker] Executing code with timeout ${timeout}ms`);
      console.log(`[SandboxWorker] Code snippet: ${code.substring(0, 100)}...`);
    }

    // Create sandbox context with safe functions and unsafe function wrappers
    const sandboxContext = createSandboxContext();

    // Merge with provided context
    const mergedContext = { ...sandboxContext, ...context };

    // Create a function with the provided code
    const functionBody = `
      "use strict";
      try {
        ${code}
      } catch (error) {
        return { error: error.message || 'Unknown error' };
      }
    `;

    // Create and execute the dynamic function
    const contextVarNames = Object.keys(mergedContext);
    const contextVarValues = contextVarNames.map(name => mergedContext[name]);
    
    const dynamicFunction = new Function(...contextVarNames, functionBody);
    let result = dynamicFunction(...contextVarValues);

    // If the result is a Promise, await it
    if (result && typeof result === 'object' && typeof result.then === 'function') {
      if (debugMode) {
        console.log(`[SandboxWorker] Result is a Promise, awaiting it...`);
      }
      try {
        result = await result;
        if (debugMode) {
          console.log(`[SandboxWorker] Promise resolved to:`, typeof result, result);
        }
      } catch (promiseError: any) {
        if (debugMode) {
          console.error(`[SandboxWorker] Promise rejected:`, promiseError);
        }
        return {
          result: null,
          error: promiseError instanceof Error ? promiseError.message : String(promiseError),
          executionTime: Date.now() - startTime
        };
      }
    }

    if (debugMode) {
      console.log(`[SandboxWorker] Final result type:`, typeof result, 'isPromise:', result && typeof result === 'object' && typeof result.then === 'function');
    }

    // Calculate execution time
    const executionTime = Date.now() - startTime;

    if (debugMode) {
      console.log(`[SandboxWorker] Code executed successfully in ${executionTime}ms`);
    }

    // Check if the result contains an error
    if (result && typeof result === 'object' && 'error' in result) {
      return {
        result: null,
        error: String(result.error),
        executionTime
      };
    }

    return {
      result,
      error: null,
      executionTime
    };
  } catch (error: any) {
    // Calculate execution time even for errors
    const executionTime = Date.now() - startTime;

    if (debugMode) {
      console.error(`[SandboxWorker] Error executing code: ${error}`);
    }

    return {
      result: null,
      error: error instanceof Error ? error.message : String(error),
      executionTime
    };
  }
}



/**
 * Create the sandbox context with available functions
 */
function createSandboxContext(): Record<string, any> {
  // Create the sandbox context
  const sandbox: Record<string, any> = {
    // Add console for debugging
    console: {
      log: debugMode ? console.log : () => {},
      error: debugMode ? console.error : () => {},
      warn: debugMode ? console.warn : () => {},
      info: debugMode ? console.info : () => {},
    },
    
    // Basic utilities that are safe to expose
    setTimeout,
    clearTimeout,
    
    // Add Math, JSON, Date, etc. as they are safe to use
    Math,
    JSON,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Error,
  };

  // Add all safe functions directly to the sandbox
  for (const [name, func] of Object.entries(safeFunctions)) {
    sandbox[name] = func;
  }
  
  // First, add all unsafe function placeholders to avoid circular dependency
  const functionWrappers = new Map<string, any>();
  
  for (const [name, func] of unsafeFunctions.entries()) {
    if (debugMode) {
      console.log(`[SandboxWorker] Adding unsafe function "${name}" to sandbox context`);
    }
    
    // Detect if the function implementation is async
    const isAsync = func.impl.includes('await') || func.impl.includes('async');
    
    if (isAsync) {
      // Create async function wrapper
      functionWrappers.set(name, (...args: any[]) => {
        if (debugMode) {
          console.warn(`[SandboxWorker] Executing async unsafe function "${name}" with args:`, args);
        }
        
        // Create function with access to current sandbox context
        const contextKeys = Object.keys(sandbox);
        const contextValues = contextKeys.map(key => sandbox[key]);
        
        // func.impl contains the complete function definition, so we need to:
        // 1. Execute the function definition to declare it
        // 2. Then call the function with the provided args
        const wrapperCode = `
          ${func.impl}
          return ${name}(...args);
        `;
        const asyncFunction = new Function(...contextKeys, 'args', `return (async function() { ${wrapperCode} })()`);
        return asyncFunction(...contextValues, args);
      });
    } else {
      // Create synchronous function wrapper
      functionWrappers.set(name, (...args: any[]) => {
        if (debugMode) {
          console.warn(`[SandboxWorker] Executing sync unsafe function "${name}" with args:`, args);
        }
        
        try {
          // Create function with access to current sandbox context
          const contextKeys = Object.keys(sandbox);
          const contextValues = contextKeys.map(key => sandbox[key]);
          
          // func.impl contains the complete function definition, so we need to:
          // 1. Execute the function definition to declare it
          // 2. Then call the function with the provided args
          const wrapperCode = `
            ${func.impl}
            return ${name}(...args);
          `;
          
          if (debugMode) {
            console.log(`[SandboxWorker] Executing wrapper code for "${name}":`, wrapperCode.substring(0, 200) + '...');
            console.log(`[SandboxWorker] Context keys:`, contextKeys);
          }
          
          const syncFunction = new Function(...contextKeys, 'args', wrapperCode);
          const result = syncFunction(...contextValues, args);
          
          if (debugMode) {
            console.log(`[SandboxWorker] Function "${name}" returned:`, result);
          }
          
          return result;
        } catch (error: any) {
          if (debugMode) {
            console.error(`[SandboxWorker] Error in unsafe function "${name}":`, error);
            console.error(`[SandboxWorker] Function implementation:`, func.impl);
          }
          throw error;
        }
      });
    }
  }
  
  // Now add all the function wrappers to the sandbox
  for (const [name, wrapper] of functionWrappers.entries()) {
    sandbox[name] = wrapper;
  }

  return sandbox;
}

// Set up message handling from the main thread
parentPort.on('message', async (message: WorkerMessage) => {
  try {
    switch (message.type) {
      case 'init':
        // Initialize worker with debug mode
        if (message.debugMode !== undefined) {
          debugMode = message.debugMode;
        }

        const initErrors: string[] = [];

        // Optionally register multiple unsafe functions if provided in init
        if (message.unsafeFunctions && Array.isArray(message.unsafeFunctions)) {
          for (const func of message.unsafeFunctions) {
            const result = registerUnsafeFunction(func);
            if (!result.success) {
              initErrors.push(`Function '${func.name}': ${result.error}`);
            }
          }
        }

        if (initErrors.length > 0) {
          // Send error instead of ready if any function registration failed
          parentPort!.postMessage({
            type: 'error',
            message: `Initialization failed: ${initErrors.join('; ')}`,
            requestId: message.requestId
          });
          break;
        }

        // Only send ready if everything succeeded
        parentPort!.postMessage({
          type: 'ready',
          requestId: message.requestId
        });
        break;

      case 'register':
        // Register an unsafe function with proper error handling
        const registrationResult = registerUnsafeFunction(message.function);
        
        parentPort!.postMessage({
          type: 'result',
          operation: 'register',
          functionName: message.function.name,
          success: registrationResult.success,
          error: registrationResult.error || null,
          requestId: message.requestId
        });
        break;

      case 'execute':
        // Execute code in the sandbox
        const result = await executeCode(
          message.code,
          message.context || {},
          { timeoutMs: message.timeoutMs }
        );
        parentPort!.postMessage({
          type: 'result',
          operation: 'execute',
          ...result,
          requestId: message.requestId
        });
        break;

      case 'terminate':
        // Clean up and exit
        if (debugMode) {
          console.log('[SandboxWorker] Terminating worker...');
        }
        process.exit(0);
        break;

      default:
        // Handle unknown message type
        const unknownMessage = message as any;
        parentPort!.postMessage({
          type: 'error',
          message: `Unknown message type: ${unknownMessage.type}`,
          requestId: unknownMessage.requestId
        });
    }
  } catch (error: any) {
    // Send error back to main thread
    parentPort!.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      requestId: message.requestId
    });
  }
});

// Handle worker errors
process.on('uncaughtException', (error) => {
  console.error('[SandboxWorker] Uncaught exception:', error);
  parentPort!.postMessage({
    type: 'error',
    message: error.message,
    stack: error.stack
  });
});