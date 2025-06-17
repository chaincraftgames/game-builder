import dotenv from 'dotenv';
import { HumanMessage } from '@langchain/core/messages';
import { getModel } from '#chaincraft/ai/model.js';

// Load environment variables
dotenv.config();

/**
 * Configure the model - we use a powerful model for code generation
 */
export const setupModel = async () => {
  const MODEL_NAME = process.env.CHAINCRAFT_DISCOVERY_MODEL_NAME;
  const model = await getModel(MODEL_NAME);
  return { model, MODEL_NAME };
};

/**
 * Invoke the model with a prompt
 * @param {Object} model - The language model to use
 * @param {string} prompt - The prompt text to send to the model
 * @param {Object} callbacks - Optional callbacks for tracing
 * @returns {Promise<Object>} The model's response
 */
export const invokeModel = async (model, prompt, callbacks = []) => {
  return await model.invoke(
    [
      new HumanMessage(prompt)
    ],
    {
      callbacks,
    }
  );
};

/**
 * Safely execute a function with timeout and memory limits
 */
export const safeExecute = async (fnCode, args, timeoutMs = 3000) => {
  const startTime = Date.now();
  const startMemory = process.memoryUsage().heapUsed;
  
  // Maximum memory increase allowed (50MB)
  const maxMemoryIncrease = 50 * 1024 * 1024;
  
  // Logs capture
  const logs = [];
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  
  // Override console methods to capture logs
  console.log = (...args) => {
    logs.push(args.map(arg => String(arg)).join(' '));
  };
  
  console.error = (...args) => {
    logs.push(`ERROR: ${args.map(arg => String(arg)).join(' ')}`);
  };
  
  try {
    return await new Promise((resolve, reject) => {
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
export const extractImplementedFunctions = (code) => {
  if (!code) return [];
  
  const functionPattern = /function\s+([a-zA-Z0-9_]+)\s*\(/g;
  const arrowFunctionPattern = /(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:\([^)]*\)|[^=]*)\s*=>/g;
  
  const functionMatches = [...code.matchAll(functionPattern)].map(match => match[1]);
  const arrowFunctionMatches = [...code.matchAll(arrowFunctionPattern)].map(match => match[1]);
  
  return [...new Set([...functionMatches, ...arrowFunctionMatches])];
};

/**
 * Normalize designed functions to handle potential inconsistencies in naming
 * @param {Array} functions - Array of function objects from the design
 * @returns {Array} Normalized array of function objects
 */
export const normalizeDesignedFunctions = (functions) => {
  if (!functions || !Array.isArray(functions)) return [];
  
  // Remove any potential duplicates and normalize function names
  const uniqueFunctions = [];
  const seen = new Set();
  
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