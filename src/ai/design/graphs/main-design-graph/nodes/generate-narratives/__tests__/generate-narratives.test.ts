/**
 * Tests for narrative generation node
 */

import { describe, it, expect, beforeAll } from "@jest/globals";
import { setupNarrativeModel } from "#chaincraft/ai/model-config.js";
import { createGenerateNarratives } from "../index.js";
import { GameDesignState } from "#chaincraft/ai/design/game-design-state.js";

// Helper to create minimal state for testing (satisfies TypeScript but only sets relevant fields)
function createTestState(overrides: Partial<typeof GameDesignState.State>): typeof GameDesignState.State {
  return {
    messages: [],
    title: "Test Game",
    systemPromptVersion: "1.0",
    specVersion: 0,
    specUpdateNeeded: false,
    metadataUpdateNeeded: false,
    pendingSpecChanges: [],
    forceSpecGeneration: false,
    validationErrors: [],
    retryCount: 0,
    narrativesNeedingUpdate: [],
    ...overrides
  } as typeof GameDesignState.State;
}

describe("Generate Narratives - Integration", () => {
  let narrativeModel: any;
  let generateNarratives: any;
  
  beforeAll(async () => {
    narrativeModel = await setupNarrativeModel();
    generateNarratives = createGenerateNarratives(narrativeModel);
  });
  
  it("should generate narrative content for markers", async () => {
    const skeleton = `
# Survival Horror Game

## Overview
A psychological horror game where players explore an abandoned facility.

## Tone and Style
!___ NARRATIVE:TONE_STYLE ___!

## Game Mechanics
Players have limited resources and must manage fear levels.
`;
    
    const state = createTestState({
      currentSpec: {
        summary: "A survival horror game",
        playerCount: { min: 1, max: 1 },
        designSpecification: skeleton,
        version: 1,
      },
      narrativesNeedingUpdate: ["TONE_STYLE"],
      narrativeStyleGuidance: "Dark, atmospheric, focuses on psychological tension rather than jump scares",
    });
    
    const result = await generateNarratives(state);
    
    // Check that narrative was generated
    expect(result.specNarratives).toBeDefined();
    expect(result.specNarratives?.TONE_STYLE).toBeDefined();
    expect(typeof result.specNarratives?.TONE_STYLE).toBe("string");
    expect(result.specNarratives?.TONE_STYLE.length).toBeGreaterThan(100);
    
    // Check that markers list was cleared
    expect(result.narrativesNeedingUpdate).toEqual([]);
    
    console.log("\n--- Generated Narrative for TONE_STYLE ---");
    console.log(result.specNarratives?.TONE_STYLE);
    console.log("--- End Narrative ---\n");
  }, 60000);
  
  it("should handle multiple markers", async () => {
    const skeleton = `
# Card Game

## Flavor Text
!___ NARRATIVE:FLAVOR_TEXT_STYLE ___!

## Victory Messages
!___ NARRATIVE:VICTORY_MESSAGES ___!
`;
    
    const state: typeof GameDesignState.State = {
      messages: = createTestState({
      currentSpec: {
        summary: "A strategic card game",
        playerCount: { min: 2, max: 4 },
        designSpecification: skeleton,
        version: 1,
      },
      narrativesNeedingUpdate: ["FLAVOR_TEXT_STYLE", "VICTORY_MESSAGES"],
      narrativeStyleGuidance: "Epic fantasy theme with dramatic language",
    })
    const result = await generateNarratives(state);
    
    // Check both narratives were generated
    expect(result.specNarratives?.FLAVOR_TEXT_STYLE).toBeDefined();
    expect(result.specNarratives?.VICTORY_MESSAGES).toBeDefined();
    
    // Check both are substantial
    expect(result.specNarratives?.FLAVOR_TEXT_STYLE.length).toBeGreaterThan(100);
    expect(result.specNarratives?.VICTORY_MESSAGES.length).toBeGreaterThan(100);
    
    // Check markers cleared
    expect(result.narrativesNeedingUpdate).toEqual([]);
    
    console.log("\n--- Generated Narratives ---");
    console.log("FLAVOR_TEXT_STYLE:", result.specNarratives?.FLAVOR_TEXT_STYLE);
    console.log("\nVICTORY_MESSAGES:", result.specNarratives?.VICTORY_MESSAGES);
    console.log("--- End Narratives ---\n");
  }, 90000);
  
  it("should skip generation when no markers", async () => {
    const state: typeof GameDesignState.State = {
      messages: = createTestState({
      currentSpec: {
        summary: "A simple game",
        playerCount: { min: 2, max: 2 },
        designSpecification: "# Simple Game\nNo markers here.",
        version: 1,
      },
      narrativesNeedingUpdate: [],
    })
    const result = await generateNarratives(state);
    
    // Should return empty object or minimal update
    expect(result.narrativesNeedingUpdate).toEqual([]);
  });
  
  it("should skip generation when no currentSpec", async () => {
    const state: typeof GameDesignState.State = {
      messages: [],
      narrative = createTestState({
      narrativesNeedingUpdate: ["SOME_MARKER"],
    })onst result = await generateNarratives(state);
    
    // Should clear the markers list
    expect(result.narrativesNeedingUpdate).toEqual([]);
  });
});

describe("Generate Narratives - Caching", () => {
  let narrativeModel: any;
  let generateNarratives: any;
  
  beforeAll(async () => {
    narrativeModel = await setupNarrativeModel();
    generateNarratives = createGenerateNarratives(narrativeModel);
  });
  
  it("should use caching for repeated narrative generation", async () => {
    const skeleton = `
# Test Game

## Section 1
!___ NARRATIVE:MARKER_1 ___!

## Section 2  
!___ NARRATIVE:MARKER_2 ___!
`;
    
    const baseState: typeof GameDesignState.State = {
      messages: [],
      currentSpec:  = createTestState({
      currentSpec: {
        summary: "Test game for caching",
        playerCount: { min: 1, max: 4 },
        designSpecification: skeleton,
        version: 1,
      },
      narrativeStyleGuidance: "Test style guidance for caching validation",
    })/ First call - should create cache
    console.log("\n--- First call (cache creation) ---");
    const state1 = {
      ...baseState,
      narrativesNeedingUpdate: ["MARKER_1"],
    };
    const result1 = await generateNarratives(state1);
    expect(result1.specNarratives?.MARKER_1).toBeDefined();
    
    // Second call with same skeleton - should use cache
    console.log("\n--- Second call (cache hit) ---");
    const state2 = {
      ...baseState,
      narrativesNeedingUpdate: ["MARKER_2"],
    };
    const result2 = await generateNarratives(state2);
    expect(result2.specNarratives?.MARKER_2).toBeDefined();
    
    console.log("\n--- Caching Test Complete ---");
    console.log("Check console output for cache statistics (cache_creation_input_tokens vs cache_read_input_tokens)");
  }, 90000);
});
