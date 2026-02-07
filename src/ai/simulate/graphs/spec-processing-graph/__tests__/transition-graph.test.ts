/**
 * TransitionGraph Tests
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { TransitionGraph, getOrBuildGraph, clearGraphCache } from '../transition-graph.js';
import type { TransitionsArtifact, InstructionsArtifact } from '#chaincraft/ai/simulate/schema.js';

describe('TransitionGraph', () => {
  beforeEach(() => {
    clearGraphCache();
  });

  const simpleTransitions: TransitionsArtifact = {
    phases: ['init', 'play', 'finished'],
    phaseMetadata: [
      { phase: 'init', requiresPlayerInput: false },
      { phase: 'play', requiresPlayerInput: true },
      { phase: 'finished', requiresPlayerInput: false },
    ],
    transitions: [
      {
        id: 'initialize_game',
        fromPhase: 'init',
        toPhase: 'play',
        checkedFields: [],
        preconditions: [],
      },
      {
        id: 'end_game',
        fromPhase: 'play',
        toPhase: 'finished',
        checkedFields: ['game.gameEnded'],
        preconditions: [
          {
            id: 'game_ended',
            logic: { '==': [{ var: 'game.gameEnded' }, true] },
            deterministic: true,
            explain: 'Game has ended',
          },
        ],
      },
    ],
  };

  const simpleInstructions: InstructionsArtifact = {
    playerPhases: {
      play: {
        phase: 'play',
        playerActions: [],
      },
    },
    transitions: {
      initialize_game: {
        id: 'initialize_game',
        description: 'Initialize game',
        stateDelta: [
          { op: 'set', path: 'game.currentPhase', value: 'play' },
          { op: 'set', path: 'game.gameEnded', value: false },
        ],
        publicMessage: 'Game starting!',
      },
      end_game: {
        id: 'end_game',
        description: 'End game and declare winners',
        stateDelta: [
          { op: 'set', path: 'game.currentPhase', value: 'finished' },
          { op: 'set', path: 'game.gameEnded', value: true },
          { op: 'set', path: 'game.winningPlayers', value: ['player1'] },
        ],
        publicMessage: 'Game over!',
      },
    },
  };

  describe('construction', () => {
    it('should build graph from transitions only', () => {
      const graph = new TransitionGraph(simpleTransitions);
      expect(graph).toBeDefined();
      expect(graph.getTerminalPhase()).toBe('finished');
    });

    it('should build graph with instructions', () => {
      const graph = new TransitionGraph(simpleTransitions, simpleInstructions);
      expect(graph).toBeDefined();
    });
  });

  describe('getTerminalPhase', () => {
    it('should always return "finished" by convention', () => {
      const graph = new TransitionGraph(simpleTransitions);
      expect(graph.getTerminalPhase()).toBe('finished');
    });
  });

  describe('getPathsFromTo', () => {
    it('should find simple path from init to finished', () => {
      const graph = new TransitionGraph(simpleTransitions);
      const paths = graph.getPathsFromTo('init', 'finished');
      
      expect(paths).toHaveLength(1);
      expect(paths[0].phases).toEqual(['init', 'play', 'finished']);
      expect(paths[0].transitions).toHaveLength(2);
      expect(paths[0].transitions[0].transitionId).toBe('initialize_game');
      expect(paths[0].transitions[1].transitionId).toBe('end_game');
    });

    it('should return empty array if no path exists', () => {
      const graph = new TransitionGraph(simpleTransitions);
      const paths = graph.getPathsFromTo('finished', 'init');
      expect(paths).toEqual([]);
    });

    it('should handle cycles with cycle detection', () => {
      const cycleTransitions: TransitionsArtifact = {
        phases: ['a', 'b', 'c'],
        phaseMetadata: [],
        transitions: [
          { id: 't1', fromPhase: 'a', toPhase: 'b', checkedFields: [], preconditions: [] },
          { id: 't2', fromPhase: 'b', toPhase: 'a', checkedFields: [], preconditions: [] },
          { id: 't3', fromPhase: 'b', toPhase: 'c', checkedFields: [], preconditions: [] },
        ],
      };
      const graph = new TransitionGraph(cycleTransitions);
      const paths = graph.getPathsFromTo('a', 'c');
      
      // Should find path without infinite loop
      expect(paths).toHaveLength(1);
      expect(paths[0].phases).toEqual(['a', 'b', 'c']);
    });
  });

  describe('findFieldSetters', () => {
    it('should find transitions that set a field', () => {
      const graph = new TransitionGraph(simpleTransitions, simpleInstructions);
      const setters = graph.findFieldSetters('game.winningPlayers');
      
      expect(setters).toHaveLength(1);
      expect(setters[0].transitionId).toBe('end_game');
    });

    it('should return empty array if no setters found', () => {
      const graph = new TransitionGraph(simpleTransitions, simpleInstructions);
      const setters = graph.findFieldSetters('game.nonExistentField');
      expect(setters).toEqual([]);
    });
  });

  describe('pathSetsField', () => {
    it('should detect if path sets a field', () => {
      const graph = new TransitionGraph(simpleTransitions, simpleInstructions);
      const paths = graph.getTerminalPaths();
      
      expect(paths).toHaveLength(1);
      expect(graph.pathSetsField(paths[0], 'game.winningPlayers')).toBe(true);
      expect(graph.pathSetsField(paths[0], 'game.nonExistent')).toBe(false);
    });
  });

  describe('isReachableFromInit', () => {
    it('should detect reachable phases', () => {
      const graph = new TransitionGraph(simpleTransitions);
      expect(graph.isReachableFromInit('play')).toBe(true);
      expect(graph.isReachableFromInit('finished')).toBe(true);
    });

    it('should detect unreachable phases', () => {
      const unreachableTransitions: TransitionsArtifact = {
        phases: ['init', 'a', 'b', 'orphan'],
        phaseMetadata: [],
        transitions: [
          { id: 't1', fromPhase: 'init', toPhase: 'a', checkedFields: [], preconditions: [] },
          { id: 't2', fromPhase: 'a', toPhase: 'b', checkedFields: [], preconditions: [] },
        ],
      };
      const graph = new TransitionGraph(unreachableTransitions);
      
      expect(graph.isReachableFromInit('a')).toBe(true);
      expect(graph.isReachableFromInit('b')).toBe(true);
      expect(graph.isReachableFromInit('orphan')).toBe(false);
    });
  });

  describe('caching', () => {
    it('should cache graphs by thread and artifacts', () => {
      const graph1 = getOrBuildGraph('thread1', simpleTransitions, simpleInstructions);
      const graph2 = getOrBuildGraph('thread1', simpleTransitions, simpleInstructions);
      
      // Should return same instance
      expect(graph1).toBe(graph2);
    });

    it('should create new graph for different thread', () => {
      const graph1 = getOrBuildGraph('thread1', simpleTransitions, simpleInstructions);
      const graph2 = getOrBuildGraph('thread2', simpleTransitions, simpleInstructions);
      
      // Different instances but same structure
      expect(graph1).not.toBe(graph2);
      expect(graph1.getTerminalPhase()).toEqual(graph2.getTerminalPhase());
    });

    it('should create new graph when artifacts change', () => {
      const graph1 = getOrBuildGraph('thread1', simpleTransitions, simpleInstructions);
      
      const modifiedTransitions = {
        ...simpleTransitions,
        transitions: [...simpleTransitions.transitions, {
          id: 'new_transition',
          fromPhase: 'finished',
          toPhase: 'init',
          checkedFields: [],
          preconditions: [],
        }],
      };
      
      const graph2 = getOrBuildGraph('thread1', modifiedTransitions, simpleInstructions);
      
      // Should be different graph
      expect(graph1).not.toBe(graph2);
    });
  });
});
