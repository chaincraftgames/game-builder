/**
 * RNG Utilities for Router
 * 
 * Handles deterministic random value generation by processing special
 * stateDelta operations with RNG semantics.
 * 
 * Design Principles:
 * - Use standard stateDelta operation format with "rng" op type
 * - Separation of concerns: Code handles randomness, LLM handles content/logic
 * - Reproducibility: Support seeding for deterministic testing
 * - No template resolution needed - directly sets state paths
 * 
 * Example stateDelta with RNG:
 * {
 *   "op": "rng",
 *   "path": "game.oracleMood",
 *   "choices": ["calm", "irritable", "cryptic"],
 *   "probabilities": [0.33, 0.33, 0.34]
 * }
 * 
 * Or for binary chance (5% activation):
 * {
 *   "op": "rng",
 *   "path": "game.specialMoment",
 *   "choices": [true, false],
 *   "probabilities": [0.05, 0.95]
 * }
 */

export interface RngOperation {
  op: 'rng';
  path: string;
  choices: any[];
  probabilities: number[];
}

/**
 * Process stateDelta operations, executing RNG operations and converting
 * them to standard "set" operations with concrete values.
 * 
 * @param stateDelta - Array of stateDelta operations (may include "rng" ops)
 * @param seed - Optional seed for reproducible randomness
 * @returns Array with RNG ops replaced by set ops with concrete values
 */
export function processStateDeltaWithRng(
  stateDelta: any[],
  seed?: number,
  playerMapping?: Record<string, string>
): any[] {
  if (!stateDelta || stateDelta.length === 0) {
    return stateDelta;
  }

  // Use seeded RNG if provided (for testing)
  const rng = seed !== undefined ? createSeededRng(seed) : Math.random;

  return stateDelta.flatMap((operation: any) => {
    if (operation.op === 'setForRandomPlayer') {
      const aliases = Object.keys(playerMapping ?? {});
      if (aliases.length === 0) {
        console.warn('[rng-utils] setForRandomPlayer: no players in mapping — op cannot be resolved');
        return [operation];
      }
      const selectedAlias = aliases[Math.floor(rng() * aliases.length)];
      const selectedUUID = (playerMapping ?? {})[selectedAlias];
      console.log(`[rng-utils] setForRandomPlayer: selected ${selectedAlias} (${selectedUUID.slice(0, 8)}) for field "${operation.field}"`);
      const ops: any[] = [{
        op: 'set',
        path: `players.${selectedUUID}.${operation.field}`,
        value: operation.value,
      }];
      if (operation.recordTo) {
        console.log(`[rng-utils] setForRandomPlayer: recording chosen alias "${selectedAlias}" to "${operation.recordTo}"`);
        ops.push({ op: 'set', path: operation.recordTo, value: selectedAlias });
      }
      return ops;
    }

    if (operation.op !== 'rng') {
      // Not an RNG/random-player operation - return as-is
      return operation;
    }

    const { path, choices, probabilities } = operation;
    
    // Validate probabilities sum to ~1.0
    const sum = probabilities.reduce((acc: number, p: number) => acc + p, 0);
    if (Math.abs(sum - 1.0) > 0.01) {
      console.warn(`[rng-utils] Probabilities for ${path} sum to ${sum}, not 1.0`);
    }
    
    // Select random value
    const value = selectRandomChoice(choices, probabilities, rng);
    
    console.log(`[rng-utils] RNG operation for ${path}: selected "${value}" from [${choices.join(', ')}]`);
    
    // Convert to standard "set" operation
    return {
      op: 'set',
      path,
      value
    };
  });
}

/**
 * Select a random choice from array with weighted distribution.
 * 
 * @param choices - Array of possible values (any type)
 * @param probabilities - Probability weights (should sum to ~1.0)
 * @param rng - Random number generator function [0, 1)
 */
function selectRandomChoice(
  choices: any[],
  probabilities: number[],
  rng: () => number
): any {
  const random = rng();
  
  let cumulative = 0;
  for (let i = 0; i < choices.length; i++) {
    cumulative += probabilities[i];
    if (random < cumulative) {
      return choices[i];
    }
  }

  // Fallback to last choice (rounding errors)
  return choices[choices.length - 1];
}

/**
 * Create a seeded pseudo-random number generator.
 * Uses a simple LCG (Linear Congruential Generator) for reproducibility.
 *
 * Uses BigInt arithmetic to avoid floating-point precision loss:
 * state * 1103515245 can exceed Number.MAX_SAFE_INTEGER, causing low-bit
 * corruption before the & 0x7fffffff mask is applied if done in float64.
 *
 * @param seed - Initial seed value
 * @returns Function returning random numbers in [0, 1)
 */
function createSeededRng(seed: number): () => number {
  let state = BigInt(Math.trunc(seed));
  const M = 1103515245n;
  const C = 12345n;
  const MASK = 0x7fffffffn;
  return () => {
    // LCG parameters (same as java.util.Random) — BigInt keeps all 31 bits exact
    state = (state * M + C) & MASK;
    return Number(state) / 0x7fffffff;
  };
}

/**
 * Main entry point: Process instructions with RNG resolution.
 * 
 * Looks for "rng" operations in stateDelta and replaces them with
 * "set" operations containing randomly selected values.
 * 
 * @param instructions - Instructions JSON string or object
 * @param seed - Optional seed for reproducible testing
 * @returns Instructions with RNG operations resolved to set operations
 */
export function processRngInstructions(
  instructions: string | object,
  seed?: number,
  playerMapping?: Record<string, string>
): string {
  const instructionsObj = typeof instructions === 'string' 
    ? JSON.parse(instructions) 
    : instructions;

  // Check if stateDelta exists
  if (!instructionsObj.stateDelta || !Array.isArray(instructionsObj.stateDelta)) {
    // No stateDelta - return as-is
    return typeof instructions === 'string' ? instructions : JSON.stringify(instructionsObj);
  }

  // Process stateDelta, converting RNG ops to set ops
  instructionsObj.stateDelta = processStateDeltaWithRng(instructionsObj.stateDelta, seed, playerMapping);

  return JSON.stringify(instructionsObj);
}
