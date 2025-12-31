/**
 * Tests for Spec Diff Node
 * 
 * Tests the LLM-powered diff generation with release notes format
 */

import { describe, expect, test } from "@jest/globals";
import { specDiff } from "../index.js";
import type { GameDesignState, GameDesignSpecification } from "#chaincraft/ai/design/game-design-state.js";

describe("Spec Diff - Release Notes Generation", () => {
  
  test("should generate release notes for new specification", async () => {
    const newSpec: GameDesignSpecification = {
      summary: "A simple coin flip guessing game",
      playerCount: { min: 2, max: 2 },
      version: 1,
      designSpecification: `# Coin Flip Guessing Game

## Setup
- 2 players take turns as Guesser and Flipper
- Need 1 coin

## Gameplay
Each round:
1. Guesser predicts heads or tails
2. Flipper flips the coin
3. If guess is correct, Guesser scores 1 point
4. Players swap roles

## Winning
First player to 5 correct guesses wins.`
    };

    const state: typeof GameDesignState.State = {
      messages: [],
      title: "Coin Flip Game",
      systemPromptVersion: "1.0",
      specUpdateNeeded: false,
      metadataUpdateNeeded: false,
      specVersion: 1,
      updatedSpec: newSpec,
      currentGameSpec: undefined,
    } as any;

    const result = await specDiff(state);

    console.log("\n=== NEW SPEC DIFF ===");
    console.log(result.specDiff);
    console.log("===================\n");

    // Verify structure
    expect(result.specDiff).toBeDefined();
    expect(result.specDiff).toContain("v1");
    expect(result.specDiff).toMatch(/coin.*flip/i);
    
    // Verify it moved spec to currentGameSpec
    expect(result.currentSpec).toEqual(newSpec);
  }, 30000);

  test("should generate release notes for specification update", async () => {
    const oldSpec: GameDesignSpecification = {
      summary: "A simple rock-paper-scissors game",
      playerCount: { min: 2, max: 2 },
      version: 1,
      designSpecification: `# Rock-Paper-Scissors

## Setup
- 2 players

## Gameplay
Players simultaneously choose rock, paper, or scissors.
- Rock beats scissors
- Scissors beats paper
- Paper beats rock

## Winning
Winner of the round wins the game.`
    };

    const newSpec: GameDesignSpecification = {
      summary: "A four-option rock-paper-scissors-volcano game",
      playerCount: { min: 2, max: 2 },
      version: 2,
      designSpecification: `# Rock-Paper-Scissors-Volcano

## Setup
- 2 players

## Gameplay
Players simultaneously choose rock, paper, scissors, or volcano.
- Rock beats scissors
- Scissors beats paper
- Paper beats rock AND volcano
- Volcano beats rock AND scissors

## Winning
Winner of the round wins the game.`
    };

    const state: typeof GameDesignState.State = {
      messages: [],
      title: "RPS Volcano",
      systemPromptVersion: "1.0",
      specUpdateNeeded: false,
      metadataUpdateNeeded: false,
      specVersion: 2,
      updatedSpec: newSpec,
      currentGameSpec: oldSpec,
    } as any;

    const result = await specDiff(state);

    console.log("\n=== UPDATE SPEC DIFF ===");
    console.log(result.specDiff);
    console.log("===================\n");

    // Verify structure
    expect(result.specDiff).toBeDefined();
    expect(result.specDiff).toMatch(/v1.*v2/);
    expect(result.specDiff).toMatch(/volcano/i);
    expect(result.specDiff).toMatch(/added|changed|modified/i);
    
    // Verify it moved spec to currentGameSpec
    expect(result.currentSpec).toEqual(newSpec);
  }, 30000);
});
