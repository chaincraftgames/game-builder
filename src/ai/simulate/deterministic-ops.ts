/**
 * Deterministic StateDelta Operations
 * 
 * Utilities for detecting and executing deterministic state operations
 * that don't require LLM processing.
 * 
 * Deterministic operations:
 * - Have fixed literal values (no template variables {{...}})
 * - Don't require game logic computation
 * - Can be safely executed programmatically
 * 
 * Benefits:
 * - Reliability: Guaranteed execution (LLM can't forget them)
 * - Cost: No LLM tokens needed for these ops
 * - Performance: Instant application vs LLM latency
 */

import { StateDeltaOp, applyStateDeltas } from './logic/statedelta.js';
import { PlayerMapping } from './player-mapping.js';
import { BaseRuntimeState } from './schema.js';

/**
 * Check if a value contains template variables ({{variableName}})
 */
function hasTemplateVariables(value: any): boolean {
  if (value === null || value === undefined) return false;
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  return /\{\{[^}]+\}\}/.test(str);
}

/**
 * Determine if a stateDelta operation is deterministic (can be executed without LLM).
 * 
 * Deterministic operations:
 * - set/delete/append with literal values (no {{templates}})
 * - increment/transfer with numeric values (no {{templates}})
 * - merge with literal object values (no {{templates}})
 * 
 * Non-deterministic operations:
 * - Any operation with template variables in value or path
 * - RNG operations (should be preprocessed by router)
 */
export function isDeterministicOperation(op: StateDeltaOp): boolean {
  // Handle transfer operations separately (they have fromPath/toPath, not path)
  if (op.op === 'transfer') {
    const transferOp = op as any;
    if (hasTemplateVariables(transferOp.fromPath)) return false;
    if (hasTemplateVariables(transferOp.toPath)) return false;
    if (op.value !== undefined && typeof op.value !== 'number') {
      return false;
    }
    return !hasTemplateVariables(op.value);
  }
  
  // For operations with 'path' property, check if path contains templates
  if ('path' in op && hasTemplateVariables(op.path)) {
    return false;
  }
  
  // Check value content based on operation type
  if (op.op === 'set' || op.op === 'append' || op.op === 'merge') {
    return !hasTemplateVariables(op.value);
  }
  
  if (op.op === 'delete') {
    // Delete ops are deterministic if path is deterministic (no value property)
    return true;
  }
  
  if (op.op === 'increment') {
    // Value must be a number, not a template string
    if (typeof op.value !== 'number') {
      return false;
    }
    return !hasTemplateVariables(op.value);
  }
  
  if (op.op === 'rng') {
    // RNG operations are deterministic if path, choices, and probabilities have no templates
    const rngOp = op as any;
    if (hasTemplateVariables(rngOp.path)) return false;
    if (hasTemplateVariables(rngOp.choices)) return false;
    if (hasTemplateVariables(rngOp.probabilities)) return false;
    return true;
  }
  
  if (op.op === 'setForAllPlayers') {
    // setForAllPlayers is deterministic if field and value have no templates
    const setForAllOp = op as any;
    if (hasTemplateVariables(setForAllOp.field)) return false;
    return !hasTemplateVariables(setForAllOp.value);
  }
  
  return false;
}

/**
 * Transform a path from aliased format (player1, player2) to canonical format (UUID).
 * 
 * Examples:
 * - "players.player1.score" → "players.uuid-abc.score"
 * - "players.player2.score" → "players.uuid-def.score"
 * - "game.roundNumber" → "game.roundNumber" (unchanged)
 */
function transformPath(path: string, mapping: PlayerMapping): string {
  // Check for player1/player2 alias pattern
  const playerMatch = path.match(/^players\.player(\d+)\.(.+)$/);
  if (playerMatch) {
    const alias = `player${playerMatch[1]}`;
    const field = playerMatch[2];
    const uuid = mapping[alias];
    
    if (uuid) {
      return `players.${uuid}.${field}`;
    }
    
    console.warn(`[deterministic-ops] No UUID found for alias ${alias} in path: ${path}`);
    return path; // Fallback to original path
  }
  
  // No player alias found, return path unchanged
  return path;
}

/**
 * Expand and transform a stateDelta operation.
 * 
 * Handles:
 * 1. Wildcard expansion: players.[*].field → one op per player
 * 2. Alias transformation: players.player1.field → players.uuid.field
 * 3. Game-level paths: unchanged
 * 
 * Returns array of operations with canonical paths (UUIDs).
 */
export function expandAndTransformOperation(
  op: StateDeltaOp,
  mapping: PlayerMapping
): StateDeltaOp[] {
  // Handle setForAllPlayers operation - expand to individual set operations for each player
  if (op.op === 'setForAllPlayers') {
    const setForAllOp = op as any;
    const playerUuids = Object.values(mapping);
    
    if (playerUuids.length === 0) {
      console.warn('[deterministic-ops] setForAllPlayers with no players in mapping');
      return []; // No players, no operations
    }
    
    // Create one set operation per player UUID
    return playerUuids.map(uuid => ({
      op: 'set',
      path: `players.${uuid}.${setForAllOp.field}`,
      value: setForAllOp.value
    } as StateDeltaOp));
  }
  
  // Handle transfer operations separately (have fromPath/toPath)
  if (op.op === 'transfer') {
    const transferOp = op as any;
    const transformedFromPath = transformPath(transferOp.fromPath, mapping);
    const transformedToPath = transformPath(transferOp.toPath, mapping);
    
    return [{
      ...op,
      fromPath: transformedFromPath,
      toPath: transformedToPath
    } as StateDeltaOp];
  }
  
  // For operations with 'path' property
  const opPath = 'path' in op ? op.path : '';
  
  // Handle wildcard expansion first
  if (opPath.includes('[*]')) {
    const playerUuids = Object.values(mapping);
    
    if (playerUuids.length === 0) {
      console.warn('[deterministic-ops] Wildcard expansion with no players in mapping');
      return []; // No players, no operations
    }
    
    // Create one operation per player UUID
    return playerUuids.map(uuid => ({
      ...op,
      path: opPath.replace('[*]', uuid)
      // "players.[*].currentMove" → "players.uuid-abc.currentMove"
    } as StateDeltaOp));
  }
  
  // Handle standard operations (set, increment, delete, etc.) - transform aliases
  const transformedPath = transformPath(opPath, mapping);
  
  return [{
    ...op,
    path: transformedPath
  } as StateDeltaOp];
}

/**
 * Apply deterministic operations to canonical state.
 * 
 * Operations are expanded (wildcards), transformed (aliases → UUIDs),
 * and applied directly to the state without LLM involvement.
 * 
 * @param state - Canonical game state (with UUID player keys)
 * @param operations - Array of deterministic stateDelta operations
 * @param mapping - Player ID mapping (alias → UUID)
 * @returns Updated state with operations applied
 */
export function applyDeterministicOperations(
  state: BaseRuntimeState,
  operations: StateDeltaOp[],
  mapping: PlayerMapping
): BaseRuntimeState {
  if (operations.length === 0) {
    return state;
  }
  
  console.log(`[deterministic-ops] Applying ${operations.length} deterministic operations`);
  
  // Expand wildcards and transform aliases to UUIDs
  const transformedOps = operations.flatMap(op => 
    expandAndTransformOperation(op, mapping)
  );
  
  console.log(`[deterministic-ops] After expansion: ${transformedOps.length} operations`);
  
  // Apply all operations to state
  const result = applyStateDeltas(state, transformedOps);
  
  if (!result.success) {
    console.error('[deterministic-ops] Failed to apply operations:', result.errors);
    throw new Error(`Failed to apply deterministic operations: ${JSON.stringify(result.errors)}`);
  }
  
  return result.newState;
}

/**
 * Merge LLM-generated state with deterministically-applied state.
 * Deterministic operations override LLM's values EXCEPT for paths the LLM explicitly touched.
 * 
 * Strategy: Start with LLM state, then override specific fields that were
 * touched by deterministic operations, BUT skip any paths the LLM already set.
 * This preserves LLM's computed values (including expanded operations like setForAllPlayers)
 * while still applying deterministic overrides for fields the LLM didn't touch.
 * 
 * @param llmState - State returned by LLM (may have forgotten some ops)
 * @param deterministicState - State after applying deterministic ops
 * @param deterministicOps - The operations that were applied deterministically
 * @param llmTouchedPaths - Set of paths the LLM explicitly modified
 * @returns Merged state with deterministic overrides (skipping LLM-touched paths)
 */
export function mergeDeterministicOverrides(
  llmState: BaseRuntimeState,
  deterministicState: BaseRuntimeState,
  deterministicOps: StateDeltaOp[],
  llmTouchedPaths: Set<string> = new Set()
): BaseRuntimeState {
  if (deterministicOps.length === 0) {
    return llmState; // No overrides needed
  }
  
  console.log(`[deterministic-ops] Merging with ${deterministicOps.length} deterministic overrides (skipping ${llmTouchedPaths.size} LLM-touched paths)`);
  
  // Start with LLM's state (has all computed fields)
  const merged = JSON.parse(JSON.stringify(llmState)); // Deep clone
  
  let skippedCount = 0;
  
  // For each deterministic op, override the specific field from deterministic state
  // UNLESS the LLM already set that path
  for (const op of deterministicOps) {
    // Handle transfer operations (have fromPath/toPath, not path)
    if (op.op === 'transfer') {
      const transferOp = op as any;
      
      // Skip if LLM touched the toPath
      if (llmTouchedPaths.has(transferOp.toPath)) {
        console.debug(`[deterministic-ops] Skipping transfer to ${transferOp.toPath} (LLM touched)`);
        skippedCount++;
        continue;
      }
      
      // For transfer, override the toPath with the value from deterministic state
      const value = getByPath(deterministicState, transferOp.toPath);
      setByPath(merged, transferOp.toPath, value);
      continue;
    }
    
    // For operations with 'path' property
    if ('path' in op) {
      const path = (op as any).path;
      
      // Skip if LLM touched this path
      if (llmTouchedPaths.has(path)) {
        console.debug(`[deterministic-ops] Skipping override for ${path} (LLM touched)`);
        skippedCount++;
        continue;
      }
      
      const value = getByPath(deterministicState, path);
      setByPath(merged, path, value);
    }
  }
  
  if (skippedCount > 0) {
    console.log(`[deterministic-ops] Skipped ${skippedCount} deterministic overrides to preserve LLM values`);
  }
  
  return merged;
}

/**
 * Get a value from an object using dot-notation path
 */
function getByPath(obj: any, path: string): any {
  const keys = path.split('.');
  let current = obj;
  for (const key of keys) {
    if (current == null) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * Set a value in an object using dot-notation path, creating nested objects as needed
 */
function setByPath(obj: any, path: string, value: any): void {
  const keys = path.split('.');
  const lastKey = keys.pop()!;
  let current = obj;
  
  for (const key of keys) {
    if (!(key in current) || current[key] == null || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }
  
  current[lastKey] = value;
}
