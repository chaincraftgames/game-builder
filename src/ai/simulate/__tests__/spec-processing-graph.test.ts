/**
 * End-to-End Test for Spec Processing Graph
 * 
 * Validates that the full graph correctly transforms a game specification
 * into all required runtime artifacts: schema, transitions, and instructions.
 */

import { describe, expect, it } from "@jest/globals";
import { createSpecProcessingGraph } from "../graphs/spec-processing-graph/index.js";

const RPS_SPEC = `
# 3-Player Rock-Paper-Scissors Tournament

## Overview
A tournament version of Rock-Paper-Scissors for exactly 3 players, played over 3 rounds.

## Game Rules

### Setup
- Each player starts with a totalScore of 0
- Game initializes in "playing" phase
- All players must be present before game begins

### Gameplay
Each round follows this sequence:

1. **Move Submission Phase**
   - All players simultaneously choose: rock, paper, or scissors
   - Players cannot see other players' choices until all have submitted
   - Each player can only submit one move per round
   - Players cannot change their move once submitted

2. **Resolution Phase**
   - Once all players submit, moves are revealed
   - Rock beats scissors, scissors beats paper, paper beats rock
   - Each pairwise matchup awards 1 point to the winner
   - In a 3-player game, each player faces 2 opponents per round
   - Maximum 2 points per round (beating both opponents)
   - Ties in individual matchups award no points

3. **Round Completion**
   - Scores are updated after each round
   - Round number increments
   - Players can submit moves for the next round
   - Game continues until 3 rounds are complete

### Scoring Phase
After 3 complete rounds:
- Total scores are calculated (sum of all round scores)
- Player with highest totalScore wins
- Ties are possible (multiple players with same high score)
- Game transitions to finished state

### Game End
- Winner is announced
- Final scores are displayed
- No further moves are accepted
- Game state is preserved for viewing

## Victory Conditions
- Player with the highest total score after 3 rounds wins
- In case of tie, all tied players share victory
- Minimum score is 0 (losing all matchups)
- Maximum score is 6 (winning all matchups in all rounds)

## Illegal Actions
- Submitting a move when you've already submitted for current round
- Submitting an invalid move (not rock/paper/scissors)
- Attempting to move after game has ended
- Attempting to move during scoring phase
`;

describe("Spec Processing Graph - End to End", () => {
  it("should transform game specification into complete runtime artifacts", async () => {
    console.log("\n=== Starting Spec Processing Graph Test ===\n");
    
    // Create and compile the graph
    const graph = await createSpecProcessingGraph();
    
    // Run the graph with game specification
    const result = await graph.invoke({
      gameSpecification: RPS_SPEC,
    });
    
    console.log("\n=== Graph Execution Complete ===\n");
    
    // Validate all required outputs are present
    expect(result.gameRules).toBeDefined();
    expect(result.stateSchema).toBeDefined();
    expect(result.stateTransitions).toBeDefined();
    expect(result.phaseInstructions).toBeDefined();
    expect(result.exampleState).toBeDefined();
    
    console.log("✓ All artifacts generated");
    
    // Validate game rules
    expect(result.gameRules.length).toBeGreaterThan(200);
    expect(result.gameRules.toLowerCase()).toContain("rock");
    expect(result.gameRules.toLowerCase()).toContain("paper");
    expect(result.gameRules.toLowerCase()).toContain("scissors");
    console.log(`✓ Game rules: ${result.gameRules.length} characters`);
    
    // Validate state schema
    const schema = JSON.parse(result.stateSchema);
    expect(Array.isArray(schema)).toBe(true);
    expect(schema.length).toBeGreaterThanOrEqual(2);
    
    const gameField = schema.find((f: any) => f.name === "game");
    const playersField = schema.find((f: any) => f.name === "players");
    
    expect(gameField).toBeDefined();
    expect(playersField).toBeDefined();
    expect(gameField.type).toBe("object");
    expect(playersField.type).toBe("object");
    
    // Check for required runtime fields
    expect(gameField.items?.properties?.gameEnded).toBeDefined();
    expect(gameField.items?.properties?.publicMessage).toBeDefined();
    expect(playersField.items?.properties?.privateMessage).toBeDefined();
    expect(playersField.items?.properties?.illegalActionCount).toBeDefined();
    expect(playersField.items?.properties?.actionsAllowed).toBeDefined();
    expect(playersField.items?.properties?.actionRequired).toBeDefined();
    
    console.log(`✓ State schema: ${schema.length} top-level fields with all required runtime fields`);
    
    // Validate example state
    const exampleState = JSON.parse(result.exampleState);
    expect(exampleState.game).toBeDefined();
    expect(exampleState.players).toBeDefined();
    expect(typeof exampleState.players).toBe("object");
    
    const playerIds = Object.keys(exampleState.players);
    expect(playerIds.length).toBeGreaterThan(0);
    console.log(`✓ Example state: ${playerIds.length} players initialized`);
    
    // Validate state transitions
    expect(result.stateTransitions.length).toBeGreaterThan(200);
    expect(result.stateTransitions.toLowerCase()).toContain("phase");
    expect(result.stateTransitions.toLowerCase()).toContain("transition");
    expect(result.stateTransitions.toLowerCase()).toContain("playing");
    console.log(`✓ State transitions: ${result.stateTransitions.length} characters`);
    
    // Validate phase instructions
    const phaseNames = Object.keys(result.phaseInstructions);
    expect(phaseNames.length).toBeGreaterThan(0);
    
    phaseNames.forEach(phase => {
      const instructions = result.phaseInstructions[phase];
      expect(instructions).toBeDefined();
      expect(instructions.length).toBeGreaterThan(200);
      console.log(`✓ ${phase} phase instructions: ${instructions.length} characters`);
    });
    
    // Print summary
    console.log("\n=== Complete Artifact Summary ===");
    console.log(`Game Rules: ${result.gameRules.length} chars`);
    console.log(`State Schema: ${schema.length} fields`);
    console.log(`Example State: ${playerIds.length} players`);
    console.log(`Transitions: ${result.stateTransitions.length} chars`);
    console.log(`Instructions: ${phaseNames.length} phases`);
    phaseNames.forEach(phase => {
      console.log(`  - ${phase}: ${result.phaseInstructions[phase].length} chars`);
    });
    
    // Print a sample of each artifact for manual review
    console.log("\n=== Sample Output (first 300 chars of each) ===\n");
    
    console.log("GAME RULES:");
    console.log(result.gameRules.substring(0, 300) + "...\n");
    
    console.log("STATE SCHEMA:");
    console.log(result.stateSchema.substring(0, 300) + "...\n");
    
    console.log("STATE TRANSITIONS:");
    console.log(result.stateTransitions.substring(0, 300) + "...\n");
    
    console.log("PHASE INSTRUCTIONS (first phase):");
    const firstPhase = phaseNames[0];
    console.log(`${firstPhase}:`, result.phaseInstructions[firstPhase].substring(0, 300) + "...\n");
    
    console.log("EXAMPLE STATE:");
    console.log(JSON.stringify(exampleState, null, 2).substring(0, 300) + "...\n");
    
    console.log("\n=== Spec Processing Graph Test Complete ===");
    console.log("✅ All validations passed - graph is working correctly!\n");
  }, 180000); // 3 minute timeout for full graph execution
});
