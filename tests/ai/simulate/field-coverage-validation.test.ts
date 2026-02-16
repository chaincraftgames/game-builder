/**
 * Tests for field coverage validation
 * 
 * Validates that fields used in preconditions are set by stateDelta operations
 */

import { describe, test, expect, jest } from '@jest/globals';
import { validateFieldCoverage } from '../../../src/ai/simulate/graphs/spec-processing-graph/nodes/extract-instructions/validators';
import type { InstructionsArtifact } from '../../../src/ai/simulate/schema';
import type { SpecProcessingStateType } from '../../../src/ai/simulate/graphs/spec-processing-graph/spec-processing-state';
import type { BaseStore } from '@langchain/langgraph';

// Mock store for testing
function createMockStore(artifact: InstructionsArtifact): BaseStore {
  return {
    get: async (namespace: string[], key: string) => {
      if (namespace.join('.') === 'instructions.execution.output') {
        return { value: JSON.stringify(artifact) };
      }
      return undefined;
    },
    put: async () => {},
    search: async () => [],
  } as any;
}

describe('validateFieldCoverage', () => {
  test('warns when precondition field is never set', async () => {
    const instructions: InstructionsArtifact = {
      playerPhases: {},
      transitions: {
        'initialize_game': {
          id: 'initialize_game',
          transitionName: 'Initialize Game',
          stateDelta: [
            { op: 'set', path: 'game.currentPhase', value: 'playing' },
            { op: 'set', path: 'players.{{codeMakerId}}.score', value: 0 },
            // Missing: players.*.role
          ]
        }
      }
    };

    const state: SpecProcessingStateType = {
      stateTransitions: JSON.stringify({
        phases: ['init', 'playing'],
        transitions: [
          {
            id: 'some_transition',
            fromPhase: 'playing',
            toPhase: 'playing',
            checkedFields: ['game.currentPhase', 'players[*].role'],
            preconditions: []
          }
        ]
      })
    } as any;

    const store = createMockStore(instructions);
    
    // Capture console.warn output
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    
    const errors = await validateFieldCoverage(state, store, 'test-thread');
    
    // Should return no errors (warnings don't block)
    expect(errors.length).toBe(0);
    
    // But should have logged warnings
    expect(warnSpy).toHaveBeenCalled();
    const warnCalls = warnSpy.mock.calls.map(call => call.join(' '));
    expect(warnCalls.some(msg => msg.includes('players[*].role'))).toBe(true);
    expect(warnCalls.some(msg => msg.includes('never set'))).toBe(true);
    
    warnSpy.mockRestore();
  });

  test('no warnings when all fields are set', async () => {
    const instructions: InstructionsArtifact = {
      playerPhases: {},
      transitions: {
        'initialize_game': {
          id: 'initialize_game',
          transitionName: 'Initialize Game',
          stateDelta: [
            { op: 'set', path: 'game.currentPhase', value: 'playing' },
            { op: 'set', path: 'players.{{codeMakerId}}.role', value: 'Code Maker' },
            { op: 'set', path: 'players.{{codeBreakerId}}.role', value: 'Code Breaker' },
          ]
        }
      }
    };

    const state: SpecProcessingStateType = {
      stateTransitions: JSON.stringify({
        phases: ['init', 'playing'],
        transitions: [
          {
            id: 'some_transition',
            fromPhase: 'playing',
            toPhase: 'playing',
            checkedFields: ['game.currentPhase', 'players[*].role'],
            preconditions: []
          }
        ]
      })
    } as any;

    const store = createMockStore(instructions);
    
    // Capture console.warn output
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    
    const errors = await validateFieldCoverage(state, store, 'test-thread');

    // Should return no errors
    expect(errors.length).toBe(0);
    
    // Should not have logged any warnings
    expect(warnSpy).not.toHaveBeenCalled();
    
    warnSpy.mockRestore();
  });

  test('recognizes setForAllPlayers as setting field', async () => {
    const instructions: InstructionsArtifact = {
      playerPhases: {},
      transitions: {
        'initialize_game': {
          id: 'initialize_game',
          transitionName: 'Initialize Game',
          stateDelta: [
            { op: 'setForAllPlayers', field: 'actionRequired', value: false },
          ]
        }
      }
    };

    const state: SpecProcessingStateType = {
      stateTransitions: JSON.stringify({
        phases: ['init', 'playing'],
        transitions: [
          {
            id: 'some_transition',
            fromPhase: 'playing',
            toPhase: 'playing',
            checkedFields: ['players[*].actionRequired'],
            preconditions: []
          }
        ]
      })
    } as any;

    const store = createMockStore(instructions);
    
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const errors = await validateFieldCoverage(state, store, 'test-thread');

    expect(errors.length).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
    
    warnSpy.mockRestore();
  });

  test('normalizes templates correctly', async () => {
    const instructions: InstructionsArtifact = {
      playerPhases: {},
      transitions: {
        'initialize_game': {
          id: 'initialize_game',
          transitionName: 'Initialize Game',
          stateDelta: [
            // Uses template variables
            { op: 'set', path: 'players.{{playerId}}.currentGuess', value: null },
          ]
        }
      }
    };

    const state: SpecProcessingStateType = {
      stateTransitions: JSON.stringify({
        phases: ['init', 'playing'],
        transitions: [
          {
            id: 'some_transition',
            fromPhase: 'playing',
            toPhase: 'playing',
            // Uses wildcard
            checkedFields: ['players[*].currentGuess'],
            preconditions: []
          }
        ]
      })
    } as any;

    const store = createMockStore(instructions);
    
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const errors = await validateFieldCoverage(state, store, 'test-thread');

    // Template {{playerId}} should normalize to [*] and match players[*].currentGuess
    expect(errors.length).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
    
    warnSpy.mockRestore();
  });

  test('checks player phase actions too', async () => {
    const instructions: InstructionsArtifact = {
      playerPhases: {
        'playing': {
          phase: 'playing',
          playerActions: [
            {
              id: 'submit_move',
              actionName: 'Submit Move',
              stateDelta: [
                { op: 'set', path: 'players.{{playerId}}.currentMove', value: 'input.move' }
              ]
            }
          ]
        }
      },
      transitions: {}
    };

    const state: SpecProcessingStateType = {
      stateTransitions: JSON.stringify({
        phases: ['init', 'playing'],
        transitions: [
          {
            id: 'some_transition',
            fromPhase: 'playing',
            toPhase: 'done',
            checkedFields: ['players[*].currentMove'],
            preconditions: []
          }
        ]
      })
    } as any;

    const store = createMockStore(instructions);
    
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const errors = await validateFieldCoverage(state, store, 'test-thread');

    // currentMove is set by player action, so no warning
    expect(errors.length).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
    
    warnSpy.mockRestore();
  });

  test('reports which transitions use the unset field', async () => {
    const instructions: InstructionsArtifact = {
      playerPhases: {},
      transitions: {
        'init': {
          id: 'init',
          transitionName: 'Init',
          stateDelta: []
        }
      }
    };

    const state: SpecProcessingStateType = {
      stateTransitions: JSON.stringify({
        phases: ['init', 'playing'],
        transitions: [
          {
            id: 'transition_a',
            fromPhase: 'playing',
            toPhase: 'done',
            checkedFields: ['game.missingField'],
            preconditions: []
          },
          {
            id: 'transition_b',
            fromPhase: 'playing',
            toPhase: 'error',
            checkedFields: ['game.missingField'],
            preconditions: []
          }
        ]
      })
    } as any;

    const store = createMockStore(instructions);
    
    // Capture console.warn output
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    
    const errors = await validateFieldCoverage(state, store, 'test-thread');

    // Should return no errors (warnings don't block)
    expect(errors.length).toBe(0);
    
    // Should have logged warnings mentioning both transitions
    expect(warnSpy).toHaveBeenCalled();
    const warnCalls = warnSpy.mock.calls.map(call => call.join(' '));
    const relevantWarning = warnCalls.find(msg => msg.includes('game.missingField'));
    expect(relevantWarning).toBeDefined();
    expect(relevantWarning).toContain('transition_a');
    expect(relevantWarning).toContain('transition_b');
    
    warnSpy.mockRestore();
  });
});
