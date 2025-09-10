import { describe, expect, test, beforeEach, afterEach } from '@jest/globals';
import { GameCodeSandbox } from '#chaincraft/ai/codeact/sandbox/sandbox.js';
import { FunctionDefinition } from '#chaincraft/ai/codeact/function-registry.js';

describe('GameCodeSandbox', () => {
  let sandbox: GameCodeSandbox;
  let unsafeFunctions: FunctionDefinition[];
  
  beforeEach(() => {
    // Set up unsafe functions
    unsafeFunctions = [
      // Simple synchronous function
      {
        name: 'unsafeGreet',
        impl: 'function unsafeGreet(name) { return "Hello, " + name; }',
        description: 'Greets a person',
      },
      // Function that calls safe functions
      {
        name: 'unsafeCalculate',
        impl: 'function unsafeCalculate(a, b) { return safeAdd(a, b) * 2; }',
        description: 'Calculates a value using safe functions',
      },
      // Asynchronous function
      {
        name: 'unsafeDelay',
        impl: 'async function unsafeDelay(ms, value) { return new Promise(resolve => setTimeout(() => resolve(value), ms)); }',
        description: 'Returns a value after a delay',
      },
      // Function that calls other unsafe functions
      {
        name: 'unsafeComposite',
        impl: 'function unsafeComposite(name, a, b) { const greeting = unsafeGreet(name); const value = unsafeCalculate(a, b); return `${greeting} Your result is ${value}`; }',
        description: 'Combines results from other unsafe functions',
      },
      // Function that throws an error
      {
        name: 'unsafeError',
        impl: 'function unsafeError(message) { throw new Error(message); }',
        description: 'Throws an error',
      }
    ];
    
    // Create sandbox with debug mode enabled
    sandbox = new GameCodeSandbox({
      unsafeFunctions,
      debugMode: true
    });
  });

  afterEach(async () => {
    // Clean up the sandbox and terminate worker to prevent hanging async operations
    if (sandbox) {
      await sandbox.dispose();
    }
  });
  
  describe('Basic Function Execution', () => {
    test('should execute safe functions correctly', async () => {
      const result = await sandbox.execute('return safeAdd(5, 10);');
      expect(result.error).toBeNull();
      expect(result.result).toBe(15);
    });
    
    test('should execute unsafe functions correctly', async () => {
      const result = await sandbox.execute('return unsafeGreet("World");');
      expect(result.error).toBeNull();
      expect(result.result).toBe('Hello, World');
    });
  });
  
  describe('Cross-function Calls', () => {
    test('unsafe function should be able to call safe functions', async () => {
      const result = await sandbox.execute('return unsafeCalculate(7, 3);');
      expect(result.error).toBeNull();
      expect(result.result).toBe(20); // (7 + 3) * 2 = 20
    });
    
    test('unsafe function should be able to call other unsafe functions', async () => {
      const result = await sandbox.execute('return unsafeComposite("User", 4, 6);');
      expect(result.error).toBeNull();
      expect(result.result).toBe('Hello, User Your result is 20'); // Hello, User + (4+6)*2 = 20
    });
  });
  
  describe('Async Function Handling', () => {
    test('should handle async functions correctly', async () => {
      const result = await sandbox.execute('return unsafeDelay(100, "Delayed result");');
      expect(result.error).toBeNull();
      expect(result.result).toBe('Delayed result');
    });
    
    test('should handle direct Promise returns', async () => {
      const result = await sandbox.execute('return Promise.resolve("Direct promise");');
      expect(result.error).toBeNull();
      expect(result.result).toBe('Direct promise');
    });
  });
  
  describe('Error Handling', () => {
    test('should catch and report errors in unsafe functions', async () => {
      const result = await sandbox.execute('return unsafeError("Test error");');
      expect(result.error).not.toBeNull();
      expect(result.error).toContain('Test error');
    });
    
    test('should catch syntax errors in executed code', async () => {
      const result = await sandbox.execute('return x ++ y;'); // Syntax error
      expect(result.error).not.toBeNull();
    });
  });
  
  describe('Timeout Handling', () => {
    test('should terminate long-running synchronous operations', async () => {
      const result = await sandbox.execute(
        'let i = 0; while(true) { i++; }; return i;',
        {},
        { timeoutMs: 1000 }
      );
      expect(result.error).not.toBeNull();
      expect(result.error).toContain('timed out');
    });
    
    test('should terminate long-running asynchronous operations', async () => {
      const result = await sandbox.execute(
        'return new Promise(resolve => setTimeout(() => resolve("Too late"), 500));',
        {},
        { timeoutMs: 100 }
      );
      expect(result.error).not.toBeNull();
      expect(result.error).toContain('timed out');
    });
  });
  
  describe('Function Registration', () => {
    test('should allow registering additional safe functions after creation', async () => {
      const result = await sandbox.execute('return safeMultiply(5, 6);');
      expect(result.error).toBeNull();
      expect(result.result).toBe(30);
    });
    
    test('should allow registering additional unsafe functions after creation', async () => {
      const newUnsafeFunction: FunctionDefinition = {
        name: 'unsafeSubtract',
        impl: 'function unsafeSubtract(a, b) { return a - b; }',
        description: 'Subtracts two numbers',
      };
      
      sandbox.registerUnsafeFunction(newUnsafeFunction);
      const result = await sandbox.execute('return unsafeSubtract(10, 4);');
      expect(result.error).toBeNull();
      expect(result.result).toBe(6);
    });
  });
});