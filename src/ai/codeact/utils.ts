import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

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
export const extractFunctionNames = (code: string): string[] => {
  if (!code) return [];
  
  const functionPattern = /function\s+([a-zA-Z0-9_]+)\s*\(/g;
  const arrowFunctionPattern = /(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:\([^)]*\)|[^=]*)\s*=>/g;
  
  const functionMatches = Array.from(code.matchAll(functionPattern)).map(match => match[1]);
  const arrowFunctionMatches = Array.from(code.matchAll(arrowFunctionPattern)).map(match => match[1]);
  
  return [...new Set([...functionMatches, ...arrowFunctionMatches])];
};



