import dotenv from 'dotenv';
import { HumanMessage } from '@langchain/core/messages';
import { getModel } from '#chaincraft/ai/model.js';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';

// Load environment variables
dotenv.config();

/**
 * Model setup result interface
 */
export interface ModelSetup {
  model: BaseChatModel;
  MODEL_NAME: string;
}

/**
 * Model invocation response interface
 */
export interface ModelResponse {
  content: string;
  [key: string]: any;
}

/**
 * Safe execution result interface
 */
export interface ExecutionResult {
  result: any;
  logs: string[];
  executionTime: number;
  error: string | null;
}

/**
 * Configure the model - we use a powerful model for code generation
 */
export const setupModel = async (): Promise<ModelSetup> => {
  const MODEL_NAME = process.env.CHAINCRAFT_DISCOVERY_MODEL_NAME || '';
  const model = await getModel(MODEL_NAME);
  return { model, MODEL_NAME };
};

/**
 * Invoke the model with a prompt
 * @param {BaseChatModel} model - The language model to use
 * @param {string} prompt - The prompt text to send to the model
 * @param {Array} callbacks - Optional callbacks for tracing
 * @returns {Promise<ModelResponse>} The model's response
 */
export const invokeModel = async (
  model: BaseChatModel, 
  prompt: string, 
  callbacks: any[] = []
): Promise<ModelResponse> => {
  return await model.invoke(
    [
      new HumanMessage(prompt)
    ],
    {
      callbacks,
    }
  ) as ModelResponse;
};

/**
 * Safely execute a function with timeout and memory limits
 */
export const safeExecute = async (
  fnCode: string, 
  args: any, 
  timeoutMs = 3000
): Promise<ExecutionResult> => {
  const startTime = Date.now();
  const startMemory = process.memoryUsage().heapUsed;
  
  // Maximum memory increase allowed (50MB)
  const maxMemoryIncrease = 50 * 1024 * 1024;
  
  // Logs capture
  const logs: string[] = [];
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  
  // Override console methods to capture logs
  console.log = (...args: any[]) => {
    logs.push(args.map(arg => String(arg)).join(' '));
  };
  
  console.error = (...args: any[]) => {
    logs.push(`ERROR: ${args.map(arg => String(arg)).join(' ')}`);
  };
  
  try {
    return await new Promise<ExecutionResult>((resolve, reject) => {
      // Set timeout
      const timeout = setTimeout(() => {
        reject(new Error('Function execution timed out'));
      }, timeoutMs);
      
      // Set interval to check memory usage
      const memoryCheck = setInterval(() => {
        const currentMemory = process.memoryUsage().heapUsed;
        if (currentMemory - startMemory > maxMemoryIncrease) {
          clearInterval(memoryCheck);
          clearTimeout(timeout);
          reject(new Error('Memory limit exceeded'));
        }
      }, 100);
      
      try {
        // Properly handle any code block markers that might be in the response
        const cleanedFnCode = fnCode.replace(/^```(?:javascript|js)?|```$/gm, '').trim();
        
        // Create a proper function that will execute the code
        const fn = new Function('args', `
          ${cleanedFnCode}
          
          // Call the main function if it exists, otherwise assume the code will return something
          if (typeof main === 'function') {
            return main(args);
          }
          
          // If we're testing individual functions, run the specified function
          if (args.functionName && typeof args.functionName === 'string' && typeof ${args.functionName} === 'function') {
            return ${args.functionName}(args.params);
          }
          
          // If we get here, we'll return any exports defined
          return typeof exports !== 'undefined' ? exports : null;
        `);
        
        // Execute the function
        const result = fn(args);
        
        // Handle promises or direct return values
        if (result instanceof Promise) {
          result
            .then((value) => {
              clearTimeout(timeout);
              clearInterval(memoryCheck);
              resolve({
                result: value,
                logs,
                executionTime: Date.now() - startTime,
                error: null
              });
            })
            .catch((error) => {
              clearTimeout(timeout);
              clearInterval(memoryCheck);
              reject(error);
            });
        } else {
          clearTimeout(timeout);
          clearInterval(memoryCheck);
          resolve({
            result,
            logs,
            executionTime: Date.now() - startTime,
            error: null
          });
        }
      } catch (error) {
        clearTimeout(timeout);
        clearInterval(memoryCheck);
        reject(error);
      }
    });
  } catch (error) {
    return {
      result: null,
      logs,
      executionTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  } finally {
    // Restore console methods
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  }
};

/**
 * Extract function names from implemented code
 * @param {string} code - The implemented code
 * @returns {string[]} Array of function names
 */
export const extractImplementedFunctions = (code: string): string[] => {
  if (!code) return [];
  
  const functionPattern = /function\s+([a-zA-Z0-9_]+)\s*\(/g;
  const arrowFunctionPattern = /(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:\([^)]*\)|[^=]*)\s*=>/g;
  
  const functionMatches = Array.from(code.matchAll(functionPattern)).map(match => match[1]);
  const arrowFunctionMatches = Array.from(code.matchAll(arrowFunctionPattern)).map(match => match[1]);
  
  return [...new Set([...functionMatches, ...arrowFunctionMatches])];
};

/**
 * Function design interface
 */
export interface FunctionDesign {
  name: string;
  importance: string;
  [key: string]: any;
}

/**
 * Normalize designed functions to handle potential inconsistencies in naming
 * @param {Array<FunctionDesign>} functions - Array of function objects from the design
 * @returns {Array<FunctionDesign>} Normalized array of function objects
 */
export const normalizeDesignedFunctions = (functions: FunctionDesign[]): FunctionDesign[] => {
  if (!functions || !Array.isArray(functions)) return [];
  
  // Remove any potential duplicates and normalize function names
  const uniqueFunctions: FunctionDesign[] = [];
  const seen = new Set<string>();
  
  functions.forEach(fn => {
    if (!fn.name) return;
    
    const normalizedName = fn.name.trim();
    if (normalizedName && !seen.has(normalizedName.toLowerCase())) {
      seen.add(normalizedName.toLowerCase());
      uniqueFunctions.push({
        name: normalizedName,
        importance: fn.importance || 'unknown'
      });
    }
  });
  
  return uniqueFunctions;
};