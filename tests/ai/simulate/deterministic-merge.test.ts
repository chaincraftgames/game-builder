/**
 * Unit tests for deterministic merge behavior with LLM-touched paths
 * 
 * Tests the fix for the issue where deterministic overrides were clobbering
 * LLM-computed values (e.g., setForAllPlayers followed by specific override).
 */

import { describe, test, expect } from '@jest/globals';
import { mergeDeterministicOverrides } from '../../../src/ai/simulate/deterministic-ops';
import { applyStateDeltas } from '../../../src/ai/simulate/logic/statedelta';
import type { BaseRuntimeState } from '../../../src/ai/simulate/schema';
import type { StateDeltaOp } from '../../../src/ai/simulate/logic/statedelta';

describe('deterministic merge with LLM-touched paths', () => {
  test('preserves LLM override after setForAllPlayers', () => {
    // Simulate the initialize_game scenario:
    // 1. setForAllPlayers sets actionRequired=false for all players
    // 2. LLM explicitly overrides codeBreakerPlayerId to actionRequired=true
    // 3. Deterministic merge should NOT clobber the LLM's override
    
    const initialState: BaseRuntimeState = {
      game: {
        phase: 'setup',
        currentPhase: 'setup',
      },
      players: {
        'player-1': { id: 'player-1', actionRequired: true, role: 'codemaker' },
        'player-2': { id: 'player-2', actionRequired: true, role: 'codebreaker' },
      },
    };
    
    // LLM operations (already expanded from setForAllPlayers + specific override)
    const llmOps: StateDeltaOp[] = [
      { op: 'set', path: 'players.player-1.actionRequired', value: false },
      { op: 'set', path: 'players.player-2.actionRequired', value: false },
      { op: 'set', path: 'players.player-2.actionRequired', value: true }, // Override for code breaker
    ];
    
    // Apply LLM operations and track touched paths
    const llmResult = applyStateDeltas(initialState, llmOps);
    expect(llmResult.success).toBe(true);
    const llmState = llmResult.newState!;
    const llmTouchedPaths = llmResult.touchedPaths;
    
    // Verify LLM state has correct values
    expect(llmState.players['player-1'].actionRequired).toBe(false);
    expect(llmState.players['player-2'].actionRequired).toBe(true); // LLM's override preserved
    
    // Verify touched paths includes both players
    expect(llmTouchedPaths.has('players.player-1.actionRequired')).toBe(true);
    expect(llmTouchedPaths.has('players.player-2.actionRequired')).toBe(true);
    
    // Deterministic operations (just setForAllPlayers, expanded)
    const deterministicOps: StateDeltaOp[] = [
      { op: 'set', path: 'players.player-1.actionRequired', value: false },
      { op: 'set', path: 'players.player-2.actionRequired', value: false },
    ];
    
    // Apply deterministic ops to get deterministic state
    const deterministicResult = applyStateDeltas(initialState, deterministicOps);
    expect(deterministicResult.success).toBe(true);
    const deterministicState = deterministicResult.newState!;
    
    // Merge with LLM-touched paths
    const mergedState = mergeDeterministicOverrides(
      llmState,
      deterministicState,
      deterministicOps,
      llmTouchedPaths
    );
    
    // CRITICAL: LLM's override for player-2 should be preserved
    expect(mergedState.players['player-1'].actionRequired).toBe(false);
    expect(mergedState.players['player-2'].actionRequired).toBe(true); // LLM override NOT clobbered
  });
  
  test('applies deterministic override for untouched paths', () => {
    // Scenario: LLM sets some fields, deterministic sets others
    // Deterministic should override untouched fields
    
    const initialState: BaseRuntimeState = {
      game: {
        phase: 'playing',
        currentPhase: 'playing',
        score: 0,
        round: 1,
      },
      players: {},
    };
    
    // LLM only sets score
    const llmOps: StateDeltaOp[] = [
      { op: 'set', path: 'game.score', value: 100 },
    ];
    
    const llmResult = applyStateDeltas(initialState, llmOps);
    expect(llmResult.success).toBe(true);
    const llmState = llmResult.newState!;
    const llmTouchedPaths = llmResult.touchedPaths;
    
    expect(llmState.game.score).toBe(100);
    expect(llmState.game.round).toBe(1); // Untouched
    
    // Deterministic sets round
    const deterministicOps: StateDeltaOp[] = [
      { op: 'set', path: 'game.round', value: 2 },
    ];
    
    const deterministicResult = applyStateDeltas(initialState, deterministicOps);
    expect(deterministicResult.success).toBe(true);
    const deterministicState = deterministicResult.newState!;
    
    // Merge
    const mergedState = mergeDeterministicOverrides(
      llmState,
      deterministicState,
      deterministicOps,
      llmTouchedPaths
    );
    
    // LLM's value preserved, deterministic's value applied
    expect(mergedState.game.score).toBe(100); // From LLM
    expect(mergedState.game.round).toBe(2); // From deterministic (LLM didn't touch it)
  });
  
  test('skips all deterministic overrides when LLM touched same paths', () => {
    // Scenario: LLM and deterministic both set the same fields
    // LLM values should win
    
    const initialState: BaseRuntimeState = {
      game: {
        phase: 'playing',
        currentPhase: 'playing',
        score: 0,
      },
      players: {},
    };
    
    // LLM sets score to 100
    const llmOps: StateDeltaOp[] = [
      { op: 'set', path: 'game.score', value: 100 },
    ];
    
    const llmResult = applyStateDeltas(initialState, llmOps);
    const llmState = llmResult.newState!;
    const llmTouchedPaths = llmResult.touchedPaths;
    
    // Deterministic also wants to set score (to different value)
    const deterministicOps: StateDeltaOp[] = [
      { op: 'set', path: 'game.score', value: 50 },
    ];
    
    const deterministicResult = applyStateDeltas(initialState, deterministicOps);
    const deterministicState = deterministicResult.newState!;
    
    // Merge
    const mergedState = mergeDeterministicOverrides(
      llmState,
      deterministicState,
      deterministicOps,
      llmTouchedPaths
    );
    
    // LLM's value should win (deterministic override skipped)
    expect(mergedState.game.score).toBe(100);
  });
  
  test('handles setForAllPlayers tracking all player paths', () => {
    // Verify that setForAllPlayers operation tracks all player paths it touches
    
    const initialState: BaseRuntimeState = {
      game: {
        phase: 'playing',
        currentPhase: 'playing',
      },
      players: {
        'p1': { id: 'p1', score: 0 },
        'p2': { id: 'p2', score: 0 },
        'p3': { id: 'p3', score: 0 },
      },
    };
    
    // setForAllPlayers sets score=10 for all
    const ops: StateDeltaOp[] = [
      { op: 'setForAllPlayers', field: 'score', value: 10 },
    ];
    
    const result = applyStateDeltas(initialState, ops);
    expect(result.success).toBe(true);
    const touchedPaths = result.touchedPaths;
    
    // Verify all player paths were tracked
    expect(touchedPaths.has('players.p1.score')).toBe(true);
    expect(touchedPaths.has('players.p2.score')).toBe(true);
    expect(touchedPaths.has('players.p3.score')).toBe(true);
    
    // Verify state is correct
    expect(result.newState!.players['p1'].score).toBe(10);
    expect(result.newState!.players['p2'].score).toBe(10);
    expect(result.newState!.players['p3'].score).toBe(10);
  });
  
  test('handles transfer operations with touched paths', () => {
    // Verify transfer operations track both fromPath and toPath
    
    const initialState: BaseRuntimeState = {
      game: {
        phase: 'playing',
        currentPhase: 'playing',
        pot: 100,
      },
      players: {
        'p1': { id: 'p1', chips: 50 },
      },
    };
    
    const ops: StateDeltaOp[] = [
      { op: 'transfer', fromPath: 'game.pot', toPath: 'players.p1.chips', value: 20 },
    ];
    
    const result = applyStateDeltas(initialState, ops);
    expect(result.success).toBe(true);
    const touchedPaths = result.touchedPaths;
    
    // Verify both paths tracked
    expect(touchedPaths.has('game.pot')).toBe(true);
    expect(touchedPaths.has('players.p1.chips')).toBe(true);
    
    // Verify state is correct
    expect(result.newState!.game.pot).toBe(80);
    expect(result.newState!.players['p1'].chips).toBe(70);
  });
  
  test('complex scenario: multiple operations with partial overlap', () => {
    // Real-world scenario: LLM and deterministic both make changes,
    // some overlapping, some not
    
    const initialState: BaseRuntimeState = {
      game: {
        phase: 'playing',
        currentPhase: 'playing',
        round: 1,
        score: 0,
        status: 'active',
      },
      players: {
        'p1': { id: 'p1', ready: false, actionRequired: false },
        'p2': { id: 'p2', ready: false, actionRequired: false },
      },
    };
    
    // LLM sets: round, p1.actionRequired, p2.actionRequired
    const llmOps: StateDeltaOp[] = [
      { op: 'increment', path: 'game.round', value: 1 },
      { op: 'set', path: 'players.p1.actionRequired', value: true },
      { op: 'set', path: 'players.p2.actionRequired', value: false },
    ];
    
    const llmResult = applyStateDeltas(initialState, llmOps);
    const llmState = llmResult.newState!;
    const llmTouchedPaths = llmResult.touchedPaths;
    
    expect(llmState.game.round).toBe(2);
    expect(llmState.players['p1'].actionRequired).toBe(true);
    expect(llmState.players['p2'].actionRequired).toBe(false);
    
    // Deterministic sets: status, p1.actionRequired (conflict!), p1.ready
    const deterministicOps: StateDeltaOp[] = [
      { op: 'set', path: 'game.status', value: 'waiting' },
      { op: 'set', path: 'players.p1.actionRequired', value: false }, // Conflicts with LLM
      { op: 'set', path: 'players.p1.ready', value: true },
    ];
    
    const deterministicResult = applyStateDeltas(initialState, deterministicOps);
    const deterministicState = deterministicResult.newState!;
    
    // Merge
    const mergedState = mergeDeterministicOverrides(
      llmState,
      deterministicState,
      deterministicOps,
      llmTouchedPaths
    );
    
    // Results:
    // - game.round: 2 (LLM, untouched by deterministic)
    // - game.status: 'waiting' (deterministic, untouched by LLM)
    // - players.p1.actionRequired: true (LLM wins conflict)
    // - players.p1.ready: true (deterministic, untouched by LLM)
    // - players.p2.actionRequired: false (LLM, untouched by deterministic)
    
    expect(mergedState.game.round).toBe(2);
    expect(mergedState.game.status).toBe('waiting');
    expect(mergedState.players['p1'].actionRequired).toBe(true); // LLM wins
    expect(mergedState.players['p1'].ready).toBe(true); // Deterministic applied
    expect(mergedState.players['p2'].actionRequired).toBe(false);
  });
});
