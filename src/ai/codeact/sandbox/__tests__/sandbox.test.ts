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
        code: 'function unsafeGreet(name) { return "Hello, " + name; }',
        signature: 'unsafeGreet(name)',
        description: 'Greets a person',
        impl: 'return "Hello, " + args[0];'
      },
      // Function that calls safe functions
      {
        name: 'unsafeCalculate',
        code: 'function unsafeCalculate(a, b) { return safeAdd(a, b) * 2; }',
        signature: 'unsafeCalculate(a, b)',
        description: 'Calculates a value using safe functions',
        impl: 'return safeAdd(args[0], args[1]) * 2;'
      },
      // Asynchronous function
      {
        name: 'unsafeDelay',
        code: 'async function unsafeDelay(ms, value) { return new Promise(resolve => setTimeout(() => resolve(value), ms)); }',
        signature: 'unsafeDelay(ms, value)',
        description: 'Returns a value after a delay',
        impl: 'return new Promise(resolve => setTimeout(() => resolve(args[1]), args[0]));'
      },
      // Function that calls other unsafe functions
      {
        name: 'unsafeComposite',
        code: 'function unsafeComposite(name, a, b) { const greeting = unsafeGreet(name); const value = unsafeCalculate(a, b); return `${greeting} Your result is ${value}`; }',
        signature: 'unsafeComposite(name, a, b)',
        description: 'Combines results from other unsafe functions',
        impl: `
          const greeting = unsafeGreet(args[0]);
          const value = unsafeCalculate(args[1], args[2]);
          return \`\${greeting} Your result is \${value}\`;
        `
      },
      // Function that throws an error
      {
        name: 'unsafeError',
        code: 'function unsafeError(message) { throw new Error(message); }',
        signature: 'unsafeError(message)',
        description: 'Throws an error',
        impl: 'throw new Error(args[0]);'
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
        code: 'function unsafeSubtract(a, b) { return a - b; }',
        signature: 'unsafeSubtract(a, b)',
        description: 'Subtracts two numbers',
        impl: 'return args[0] - args[1];'
      };
      
      sandbox.registerUnsafeFunction(newUnsafeFunction);
      const result = await sandbox.execute('return unsafeSubtract(10, 4);');
      expect(result.error).toBeNull();
      expect(result.result).toBe(6);
    });
  });
});