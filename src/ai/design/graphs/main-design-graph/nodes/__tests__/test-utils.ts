/**
 * Test utilities for creating mock state and specifications
 */

import { GameDesignState, GameDesignSpecification } from "#chaincraft/ai/design/game-design-state.js";

/**
 * Creates a minimal mock state for testing.
 * Includes all required fields with sensible defaults.
 */
export function createMockState(overrides?: Partial<typeof GameDesignState.State>): typeof GameDesignState.State {
  return {
    messages: [],
    title: "",
    systemPromptVersion: "",
    specRequested: false,
    currentGameSpec: undefined,
    specVersion: 0,
    specUpdateNeeded: false,
    metadataUpdateNeeded: false,
    specPlan: undefined,
    metadataChangePlan: undefined,
    metadataPlan: undefined,
    spec: undefined,
    updatedSpec: undefined,
    metadata: undefined,
    specDiff: undefined,
    metadataDiff: undefined,
    validationErrors: [],
    retryCount: 0,
    lastSpecUpdate: undefined,
    lastMetadataUpdate: undefined,
    lastSpecMessageCount: undefined,
    ...overrides,
  };
}

/**
 * Creates a mock GameDesignSpecification for testing.
 */
export function createMockSpec(overrides?: Partial<GameDesignSpecification>): GameDesignSpecification {
  return {
    summary: "A test game",
    playerCount: { min: 2, max: 4 },
    designSpecification: "# Test Game\n\nA simple test specification.",
    version: 1,
    ...overrides,
  };
}
