import { describe, expect, test } from '@jest/globals';
import { 
  parseFunctions,
  extractFunctionNames,
  initializeFunctionRegistry 
} from '#chaincraft/ai/codeact/function-registry.js';

describe('Function Registry', () => {
  describe('parseFunctions', () => {
    test('should extract function with JSDoc comment', () => {
      const sampleCode = `/**
 * Creates a new game instance with initial state
 * 
 * @param {string} player1Id - Unique identifier for player 1
 * @param {string} player1Name - Display name for player 1
 * @param {string} player2Id - Unique identifier for player 2
 * @param {string} player2Name - Display name for player 2
 * @returns {Object} A complete game state object with initialized values
 * @throws {Error} If any of the player IDs or names are invalid
 */
function initializeGame(player1Id, player1Name, player2Id, player2Name) {
  // Validate inputs
  if (!player1Id || typeof player1Id !== 'string') {
    throw new Error('Player 1 ID must be a non-empty string');
  }
  if (!player1Name || typeof player1Name !== 'string') {
    throw new Error('Player 1 name must be a non-empty string');
  }
  
  return {
    gameId: 'test-game',
    players: { player1: { id: player1Id, name: player1Name } }
  };
}`;

      const functions = parseFunctions(sampleCode);
      
      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe('initializeGame');
      expect(functions[0].description).toContain('Creates a new game instance with initial state');
      expect(functions[0].impl).toContain('Validate inputs');
      expect(functions[0].impl).toContain('throw new Error');
    });

    test('should extract function without JSDoc comment', () => {
      const sampleCode = `function simpleFunction(x, y) {
  return x + y;
}`;

      const functions = parseFunctions(sampleCode);
      
      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe('simpleFunction');
      expect(functions[0].description).toBe('Function simpleFunction');
      expect(functions[0].impl).toBe('return x + y;');
    });

    test('should extract arrow function', () => {
      const sampleCode = `/**
 * Calculates the sum of two numbers
 * @param {number} a - First number
 * @param {number} b - Second number
 * @returns {number} The sum
 */
const calculateSum = (a, b) => {
  return a + b;
};`;

      const functions = parseFunctions(sampleCode);
      
      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe('calculateSum');
      expect(functions[0].description).toContain('Calculates the sum of two numbers');
      expect(functions[0].impl).toBe('return a + b;');
    });

    test('should extract multiple functions', () => {
      const sampleCode = `/**
 * Function one
 */
function functionOne() {
  return 'one';
}

/**
 * Function two
 */
function functionTwo() {
  return 'two';
}`;

      const functions = parseFunctions(sampleCode);
      
      expect(functions).toHaveLength(2);
      expect(functions[0].name).toBe('functionOne');
      expect(functions[1].name).toBe('functionTwo');
      expect(functions[0].description).toBe('Function one');
      expect(functions[1].description).toBe('Function two');
      expect(functions[0].impl).toBe("return 'one';");
      expect(functions[1].impl).toBe("return 'two';");
    });

    test('should handle empty code', () => {
      const functions = parseFunctions('');
      expect(functions).toHaveLength(0);
    });

    test('should handle complex JSDoc with multiple tags', () => {
      const sampleCode = `/**
 * Processes a game action and updates state
 * 
 * This function handles player actions during gameplay.
 * It validates the action and updates the game state accordingly.
 * 
 * @param {Object} state - Current game state
 * @param {string} playerId - ID of the player making the action
 * @param {string} action - The action being performed
 * @returns {Object} Updated game state
 * @throws {Error} If action is invalid
 * @example
 * processAction(gameState, 'player1', 'ROCK')
 * @since 1.0.0
 */
function processAction(state, playerId, action) {
  if (!state || !playerId || !action) {
    throw new Error('Invalid parameters');
  }
  return { ...state, lastAction: action };
}`;

      const functions = parseFunctions(sampleCode);
      
      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe('processAction');
      expect(functions[0].description).toContain('Processes a game action and updates state');
      expect(functions[0].description).toContain('This function handles player actions during gameplay');
      expect(functions[0].description).toContain('It validates the action and updates the game state accordingly');
      // Should NOT contain @param, @returns, etc.
      expect(functions[0].description).not.toContain('@param');
      expect(functions[0].description).not.toContain('@returns');
      expect(functions[0].description).not.toContain('@throws');
      expect(functions[0].description).not.toContain('@example');
    });
  });

  describe('extractFunctionNames', () => {
    test('should extract function names only', () => {
      const sampleCode = `function one() { return 1; }
const two = () => { return 2; }`;
      
      const names = extractFunctionNames(sampleCode);
      expect(names).toEqual(['one', 'two']);
    });
  });

  describe('initializeFunctionRegistry', () => {
    test('should create registry with functions', () => {
      const sampleCode = `/**
 * Test function
 */
function testFunc(x) {
  return x;
}`;

      const registry = initializeFunctionRegistry(sampleCode);
      
      expect(registry.getAllFunctions()).toHaveLength(1);
      expect(registry.hasFunction('testFunc')).toBe(true);
      expect(registry.hasFunction('nonExistent')).toBe(false);
      
      const func = registry.getFunction('testFunc');
      expect(func).toBeDefined();
      expect(func?.name).toBe('testFunc');
      expect(func?.description).toBe('Test function');
      expect(func?.impl).toBe('return x;');
      
      const docs = registry.getFunctionDocumentation();
      expect(docs).toContain('testFunc(): Test function');
    });

    test('should handle empty function code', () => {
      const registry = initializeFunctionRegistry('');
      
      expect(registry.getAllFunctions()).toHaveLength(0);
      expect(registry.hasFunction('anything')).toBe(false);
      expect(registry.getFunction('anything')).toBeUndefined();
      expect(registry.getFunctionDocumentation()).toBe('');
    });
  });
});
