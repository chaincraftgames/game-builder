/**
 * Test Harness Helper Functions
 */

import { getSaver } from "#chaincraft/ai/memory/checkpoint-memory.js";
import { getConfig } from "#chaincraft/config.js";

export interface SpecArtifacts {
  gameRules: string;
  stateSchema: string;
  stateTransitions: string;
  playerPhaseInstructions: Record<string, string>;
  transitionInstructions: Record<string, string>;
}

/**
 * Generate a random player ID using UUID format
 */
export function createPlayerId(): string {
  return crypto.randomUUID();
}

/**
 * Generate multiple player IDs at once
 */
export function createPlayerIds(count: number): string[] {
  return Array.from({ length: count }, () => createPlayerId());
}

/**
 * Generate a unique game ID for a test run
 */
export function createGameId(testName?: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  const prefix = testName ? testName.toLowerCase().replace(/\s+/g, '-') : 'test';
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Inject pre-generated artifacts into checkpoint storage.
 * This allows tests to bypass spec processing and use known artifact sets.
 * 
 * @param gameId - The game ID to associate artifacts with
 * @param version - The version number for the artifacts
 * @param artifacts - The pre-generated artifacts to inject
 */
export async function injectPreGeneratedArtifacts(
  gameId: string,
  version: number,
  artifacts: SpecArtifacts
): Promise<void> {
  const specKey = `${gameId}-v${version}`;
  
  console.log(`[test-harness] Injecting pre-generated artifacts for specKey: ${specKey}`);
  
  // Get saver for this spec key
  const saver = await getSaver(specKey, getConfig("simulation-graph-type"));
  
  // Create checkpoint state with artifacts
  // This mimics what spec-processing-graph saves
  const checkpointState = {
    gameRules: artifacts.gameRules,
    stateSchema: artifacts.stateSchema,
    stateTransitions: artifacts.stateTransitions,
    playerPhaseInstructions: artifacts.playerPhaseInstructions,
    transitionInstructions: artifacts.transitionInstructions,
    
    // Add validation flags to indicate artifacts are complete
    schemaValidationErrors: [],
    transitionsValidationErrors: [],
    instructionsValidationErrors: [],
  };
  
  const config = { configurable: { thread_id: specKey } };
  
  // Save checkpoint manually
  // We need to create a minimal checkpoint structure
  const checkpoint = {
    v: 1,
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    channel_values: checkpointState,
    channel_versions: {
      __start__: 1,
    },
    versions_seen: {
      __start__: {
        __start__: 1,
      },
    },
    pending_sends: [],
  };
  
  await saver.put(config, checkpoint as any, { source: "update", step: -1, writes: null }, {});
  
  console.log(`[test-harness] Successfully injected artifacts for specKey: ${specKey}`);
}
