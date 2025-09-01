/**
 * This module exports safe functions that can be used in the sandbox environment.
 * It conditionally exports different sets of functions based on whether it's running
 * in a test environment or production.
 */

// Helper to determine if we're in a test environment
const isTestEnvironment = (): boolean => {
  return process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
};

/**
 * Safe functions for testing purposes
 */
export const testFunctions = {
  // Simple addition function used in tests
  safeAdd: (a: number, b: number): number => a + b,
  
  // Safe logging function that prepends a tag
  safeLog: (message: string): string => `[SAFE] ${message}`,
  
  // Multiply two numbers
  safeMultiply: (a: number, b: number): number => a * b,
  
  // Divide two numbers
  safeDivide: (a: number, b: number): number => {
    if (b === 0) throw new Error('Division by zero');
    return a / b;
  },
  
  // Concatenate strings
  safeConcat: (a: string, b: string): string => a + b,
  
  // Generate a random number
  safeRandom: (min: number, max: number): number => 
    Math.floor(Math.random() * (max - min + 1)) + min,

  // Add a function that accepts and calls a callback
safeWithCallback: (callback: Function, ...args: any[]): any => {
    // Log that we're about to execute the callback
    console.log(`[SAFE] Executing callback with args:`, args);
    
    // Call the callback with the provided arguments
    const result = callback(...args);
    
    // Process the result in some way to verify data flow
    const processedResult = typeof result === 'string' 
      ? `[SAFE_CALLBACK_RESULT] ${result}`
      : typeof result === 'number'
        ? result * 2 // Double numeric results
        : result; // Return other types unchanged
        
    console.log(`[SAFE] Callback returned: ${result}, processed to: ${processedResult}`);
    return processedResult;
  },
  
  // Add a function that handles async callbacks
  safeWithAsyncCallback: async (callback: Function, ...args: any[]): Promise<any> => {
    console.log(`[SAFE] Executing async callback with args:`, args);
    
    // Call the callback and await its result
    const result = await callback(...args);
    
    // Process the result
    const processedResult = typeof result === 'string' 
      ? `[SAFE_ASYNC_CALLBACK_RESULT] ${result}`
      : typeof result === 'number'
        ? result * 2 // Double numeric results
        : result;
        
    console.log(`[SAFE] Async callback returned: ${result}, processed to: ${processedResult}`);
    return processedResult;
  }
};

/**
 * Production safe functions - these would be the actual game engine functions
 * available to the sandbox in production
 */
export const productionFunctions = {
  // Example production functions
  // In a real implementation, these would be your actual game engine functions
  
  // Get player information
  getPlayer: (playerId: string): object => ({ id: playerId, name: `Player ${playerId}` }),
  
  // Get game state
  getGameState: (gameId: string): object => ({ id: gameId, status: 'active' }),
  
  // Execute a game move
  executeMove: (gameId: string, playerId: string, move: string): object => 
    ({ success: true, message: `Move ${move} executed by ${playerId} in game ${gameId}` }),
  
  // Send message to player
  sendMessage: (playerId: string, message: string): boolean => true,
  
  // Log event (safe version)
  logEvent: (eventType: string, data: any): void => {
    console.log(`[EVENT] ${eventType}:`, data);
  },
};

/**
 * Export the appropriate set of functions based on environment
 */
const safeFunctions = isTestEnvironment() ? testFunctions : productionFunctions;

// Export the entire object of functions
export default safeFunctions;

// Export a function to get a Map of safe functions (for compatibility with existing code)
export function getSafeFunctions(): Map<string, Function> {
  const functionsMap = new Map<string, Function>();
  
  for (const [name, func] of Object.entries(safeFunctions)) {
    functionsMap.set(name, func);
  }
  
  return functionsMap;
}