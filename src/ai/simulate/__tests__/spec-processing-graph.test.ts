/**
 * End-to-End Test for Spec Processing Graph
 * 
 * Validates that the full graph correctly transforms a game specification
 * into all required runtime artifacts: schema, transitions, and instructions.
 */

import { describe, expect, it } from "@jest/globals";
import { createSpecProcessingGraph } from "../graphs/spec-processing-graph/index.js";
import { InMemoryStore } from "@langchain/langgraph";

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
    
    // Run the graph with game specification and store
    const result = await graph.invoke({
      gameSpecification: RPS_SPEC,
    }, {
      store: new InMemoryStore(),
      configurable: { thread_id: "test-spec-processing-1" }
    });
    
    console.log("\n=== Graph Execution Complete ===\n");
    
    // Validate all required outputs are present
    expect(result.gameRules).toBeDefined();
    expect(result.stateSchema).toBeDefined();
    expect(result.stateTransitions).toBeDefined();
    expect(result.playerPhaseInstructions).toBeDefined();
    expect(result.transitionInstructions).toBeDefined();
    expect(result.exampleState).toBeDefined();
    
    console.log("✓ All artifacts generated");
    
    // Validate game rules
    expect(result.gameRules.length).toBeGreaterThan(10);
    console.log(`✓ Game rules: ${result.gameRules.length} characters`);
    
    // Validate state schema (now planner format - array of field definitions)
    const schemaFields = JSON.parse(result.stateSchema);
    expect(Array.isArray(schemaFields)).toBe(true);
    expect(schemaFields.length).toBeGreaterThan(0);
    
    console.log(`✓ State schema: ${schemaFields.length} field definitions in planner format`);
    
    // Verify all fields have required structure
    schemaFields.forEach((field: any) => {
      expect(field.name).toBeDefined();
      expect(field.type).toBeDefined();
      expect(field.path).toBeDefined();
      expect(['game', 'player']).toContain(field.path);
    });
    console.log(`✓ All schema fields have valid structure (name, type, path)`);
    
    // Example state is no longer generated in planner-only mode
    expect(result.exampleState).toBeDefined();
    console.log(`✓ Example state present: "${result.exampleState}"`);
    
    // Validate state transitions
    expect(result.stateTransitions.length).toBeGreaterThan(200);
    expect(result.stateTransitions.toLowerCase()).toContain("phase");
    expect(result.stateTransitions.toLowerCase()).toContain("transition");
    expect(result.stateTransitions.toLowerCase()).toContain("playing");
    console.log(`✓ State transitions: ${result.stateTransitions.length} characters`);
    
    // Validate phase instructions
    const phaseNames = Object.keys(result.playerPhaseInstructions || {});
    const transitionNames = Object.keys(result.transitionInstructions || {});
    expect(phaseNames.length).toBeGreaterThan(0);
    
    phaseNames.forEach(phase => {
      const instructions = result.playerPhaseInstructions![phase];
      expect(instructions).toBeDefined();
      expect(instructions.length).toBeGreaterThan(200);
      console.log(`✓ ${phase} player phase instructions: ${instructions.length} characters`);
    });
    
    // Print summary
    console.log("\n=== Complete Artifact Summary ===");
    console.log(`Game Rules: ${result.gameRules.length} chars`);
    console.log(`State Schema: ${schemaFields.length} fields`);
    console.log(`Transitions: ${result.stateTransitions.length} chars`);
    console.log(`Player Phase Instructions: ${phaseNames.length} phases`);
    console.log(`Transition Instructions: ${transitionNames.length} transitions`);
    phaseNames.forEach(phase => {
      console.log(`  - ${phase}: ${result.playerPhaseInstructions![phase].length} chars`);
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
    if (firstPhase) {
      console.log(`${firstPhase}:`, result.playerPhaseInstructions![firstPhase].substring(0, 300) + "...\n");
    }
    
    console.log("\n=== Spec Processing Graph Test Complete ===");
    console.log("✅ All validations passed - graph is working correctly!\n");
  }, 180000); // 3 minute timeout for full graph execution
});
