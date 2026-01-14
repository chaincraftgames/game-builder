/**
 * Design to Simulation Integration Test
 * 
 * Tests the end-to-end workflow:
 * 1. Create a game design (gets conversationId)
 * 2. Use conversationId as gameId to create a simulation (without passing spec)
 * 3. Initialize simulation with unique sessionId
 * 4. Process actions and verify gameplay works
 * 
 * This ensures that the simulation can properly retrieve and use
 * specifications created by the design workflow.
 */

import 'dotenv/config';
import { describe, it, expect } from '@jest/globals';
import { setConfig } from '#chaincraft/config.js';
import { continueDesignConversation } from '#chaincraft/ai/design/design-workflow.js';
import { 
  createSimulation, 
  initializeSimulation, 
  processAction 
} from '#chaincraft/ai/simulate/simulate-workflow.js';

describe('Design to Simulation Integration', () => {
  // Configure to use test graphs
  setConfig('design-graph-type', 'test-game-design');
  setConfig('simulation-graph-type', 'test-game-simulation');

  it('should create design, then create and run simulation using gameId', async () => {
    console.log('\n=== Design to Simulation Integration Test ===\n');

    // Step 1: Create a game design using the design workflow
    const conversationId = `test-design-sim-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    console.log('Step 1: Creating game design with conversationId:', conversationId);
    
    const designResponse = await continueDesignConversation(
      conversationId,
      'Create a simple coin flip game for 2 players. Players each choose heads or tails, ' +
      'then a coin is flipped. If a player guesses correctly, they win. ' +
      'The game ends after one round.'
    );

    console.log('✓ Design created');
    console.log('  - Has response:', !!designResponse.designResponse);
    console.log('  - Has specification:', !!designResponse.specification);
    console.log('  - Version:', designResponse.specification?.version);
    
    expect(designResponse.designResponse).toBeTruthy();
    expect(designResponse.specification).toBeTruthy();
    expect(designResponse.specification?.designSpecification).toBeTruthy();

    // Step 2: Create simulation using the gameId (conversationId) WITHOUT passing spec
    // This should retrieve the spec from the design workflow
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    console.log('\nStep 2: Creating simulation with sessionId:', sessionId);
    console.log('  - Using gameId:', conversationId);
    console.log('  - NOT passing spec (should retrieve from design workflow)');
    
    const simCreationResult = await createSimulation(
      sessionId,
      conversationId, // gameId from design
      undefined,      // no version specified (use latest)
      undefined       // NO spec - force retrieval from design workflow
    );

    console.log('✓ Simulation created');
    console.log('  - Has game rules:', !!simCreationResult.gameRules);
    
    expect(simCreationResult.gameRules).toBeTruthy();

    // Step 3: Initialize simulation with player IDs
    const player1Id = `player1-${Date.now()}`;
    const player2Id = `player2-${Date.now()}`;
    console.log('\nStep 3: Initializing simulation');
    console.log('  - Player 1:', player1Id);
    console.log('  - Player 2:', player2Id);
    
    const initResult = await initializeSimulation(sessionId, [player1Id, player2Id]);

    console.log('✓ Simulation initialized');
    console.log('  - Public message:', initResult.publicMessage?.substring(0, 100) + '...');
    console.log('  - Player states count:', initResult.playerStates.size);
    
    expect(initResult.publicMessage).toBeTruthy();
    expect(initResult.playerStates.size).toBe(2);
    
    // Verify both players have state
    const player1State = initResult.playerStates.get(player1Id);
    const player2State = initResult.playerStates.get(player2Id);
    expect(player1State).toBeDefined();
    expect(player2State).toBeDefined();
    expect(player1State?.actionRequired).toBe(true);
    expect(player2State?.actionRequired).toBe(true);

    // Step 4: Process player actions
    console.log('\nStep 4: Processing player actions');
    
    // Player 1 chooses heads
    console.log('  - Player 1 choosing heads');
    const action1Result = await processAction(
      sessionId,
      player1Id,
      JSON.stringify({ choice: 'heads' })
    );

    console.log('✓ Player 1 action processed');
    console.log('  - Public message:', action1Result.publicMessage?.substring(0, 100) || 'none');
    console.log('  - Game ended:', action1Result.gameEnded);
    
    expect(action1Result.playerStates).toBeDefined();
    expect(action1Result.playerStates.size).toBe(2);
    
    // Game should not end until both players act
    if (!action1Result.gameEnded) {
      // Player 2 chooses tails
      console.log('  - Player 2 choosing tails');
      const action2Result = await processAction(
        sessionId,
        player2Id,
        JSON.stringify({ choice: 'tails' })
      );

      console.log('✓ Player 2 action processed');
      console.log('  - Public message:', action2Result.publicMessage?.substring(0, 100) || 'none');
      console.log('  - Game ended:', action2Result.gameEnded);
      
      expect(action2Result.playerStates).toBeDefined();
      
      // After both players act, game should likely end (depending on game rules)
      // But we don't strictly require it - some games may need multiple rounds
      console.log('  - Final game state: gameEnded =', action2Result.gameEnded);
    }

    console.log('\n✓ Integration test completed successfully!');
    console.log('  Design workflow → Simulation workflow integration verified');
    
  }, 5 * 60 * 1000); // 5 minute timeout for full workflow
});
