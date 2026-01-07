/**
 * Design API Consolidation Test
 * 
 * Tests the design conversation API through actual HTTP requests to verify:
 * 1. Responses are received for all turns
 * 2. Auto-consolidation triggers correctly based on thresholds
 * 3. No hanging requests when consolidation happens
 * 
 * This reproduces the reported issue where the API sometimes fails to respond
 * when auto-consolidation is triggered.
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import Fastify, { FastifyInstance } from 'fastify';
import { authenticate } from '#chaincraft/middleware/auth.js';
import { registerApiRoutes } from '#chaincraft/api/routes.js';

describe('Design API - Auto-Consolidation Flow', () => {
  let server: FastifyInstance;
  let conversationId: string;
  const apiKey = process.env.CHAINCRAFT_GAMEBUILDER_API_KEY;

  beforeAll(async () => {
    // Set up Fastify server (same config as index.ts)
    server = Fastify({
      logger: false // Reduce noise in tests
    });

    // Add authentication hook for all routes except health check
    server.addHook('onRequest', async (request, reply) => {
      if (request.url === '/health') return;
      await authenticate(request, reply);
    });

    // Register API routes
    await registerApiRoutes(server);

    // Start server on random port
    await server.listen({ port: 0, host: '127.0.0.1' });
    
    console.log(`Test server started on ${server.server.address()}`);
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    // Generate unique conversation ID for each test
    conversationId = `test-api-consolidation-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  });

  it('should respond to all turns including when auto-consolidation triggers', async () => {
    console.log(`\n=== Test: Auto-Consolidation Response Verification ===`);
    console.log(`Conversation ID: ${conversationId}\n`);

    // Turn 1: Initial request - should generate spec immediately
    console.log('--- Turn 1: Initial Request ---');
    const response1 = await server.inject({
      method: 'POST',
      url: '/api/design/conversation/continue',
      headers: {
        'Content-Type': 'application/json',
        'x-chaincraft-api-key': apiKey!
      },
      payload: {
        conversationId,
        userMessage: 'Create a simple dice rolling game for 2 players.'
      }
    });

    expect(response1.statusCode).toBe(200);
    const turn1 = JSON.parse(response1.payload);
    console.log(`✓ Status: ${response1.statusCode}`);
    console.log(`✓ Has Response: ${!!turn1.designResponse}`);
    console.log(`✓ Spec Generated: ${!!turn1.specification}`);
    console.log(`✓ Version: ${turn1.specification?.version || 'N/A'}`);
    console.log(`✓ Response Preview: ${turn1.designResponse?.substring(0, 100)}...`);
    
    expect(turn1.designResponse).toBeTruthy();
    expect(turn1.designResponse.length).toBeGreaterThan(0);
    expect(turn1.specification).toBeTruthy();

    // Turn 2: Request a change - should accumulate
    console.log('\n--- Turn 2: Request Change (accumulate) ---');
    const response2 = await server.inject({
      method: 'POST',
      url: '/api/design/conversation/continue',
      headers: {
        'Content-Type': 'application/json',
        'x-chaincraft-api-key': apiKey!
      },
      payload: {
        conversationId,
        userMessage: 'Add a scoring system where players earn points for rolling certain numbers.'
      }
    });

    expect(response2.statusCode).toBe(200);
    const turn2 = JSON.parse(response2.payload);
    console.log(`✓ Status: ${response2.statusCode}`);
    console.log(`✓ Has Response: ${!!turn2.designResponse}`);
    console.log(`✓ Spec Updated: ${!!turn2.specification}`);
    console.log(`✓ Pending Changes: ${turn2.pendingSpecChanges?.length || 0}`);
    console.log(`✓ Threshold: ${turn2.consolidationThreshold}`);
    console.log(`✓ Char Limit: ${turn2.consolidationCharLimit}`);
    console.log(`✓ Response Preview: ${turn2.designResponse?.substring(0, 100)}...`);
    
    expect(turn2.designResponse).toBeTruthy();
    expect(turn2.designResponse.length).toBeGreaterThan(0);
    // May or may not have pending changes depending on thresholds
    if (turn2.pendingSpecChanges) {
      console.log(`✓ Pending Changes Preview: ${JSON.stringify(turn2.pendingSpecChanges[0]?.substring(0, 50))}...`);
    }

    // Turn 3: Another change with long description to trigger char threshold
    console.log('\n--- Turn 3: Large Change (trigger char threshold) ---');
    const response3 = await server.inject({
      method: 'POST',
      url: '/api/design/conversation/continue',
      headers: {
        'Content-Type': 'application/json',
        'x-chaincraft-api-key': apiKey!
      },
      payload: {
        conversationId,
        userMessage: `Add detailed victory conditions: The first player to reach 50 points wins. 
          Players earn 10 points for rolling doubles, 5 points for rolling a sum of 7, 
          and 3 points for rolling a sum of 11. Add special rules for when players tie: 
          they must do a sudden death roll-off where the highest single roll wins. 
          Also add power-ups that players can collect by rolling specific combinations. 
          Include a bonus round that triggers every 5 turns where point values are doubled.
          Add a comeback mechanic where players who are behind by 20+ points get an extra die.`
      }
    });

    // This is the critical assertion - the request MUST return a response
    expect(response3.statusCode).toBe(200);
    const turn3 = JSON.parse(response3.payload);
    console.log(`✓ Status: ${response3.statusCode}`);
    console.log(`✓ Has Response: ${!!turn3.designResponse}`);
    console.log(`✓ Response Length: ${turn3.designResponse?.length || 0} chars`);
    console.log(`✓ Spec Updated: ${!!turn3.specification}`);
    console.log(`✓ Version: ${turn3.specification?.version || 'N/A'}`);
    console.log(`✓ Has Diff: ${!!turn3.specDiff}`);
    console.log(`✓ Pending Changes: ${turn3.pendingSpecChanges?.length || 0}`);
    console.log(`✓ Response Preview: ${turn3.designResponse?.substring(0, 100)}...`);

    // Critical assertions - if these fail, we've reproduced the bug
    expect(turn3.designResponse).toBeTruthy();
    expect(turn3.designResponse).not.toBe('No response');
    expect(turn3.designResponse.length).toBeGreaterThan(0);
    
    // If auto-consolidation triggered, we should have an updated spec
    if (turn3.specification) {
      console.log(`✓ Auto-consolidation triggered - spec version: ${turn3.specification.version}`);
      expect(turn3.specification.version).toBeGreaterThan(turn1.specification.version);
    }

    // Turn 4: Another change to potentially trigger plan threshold
    console.log('\n--- Turn 4: Another Change ---');
    const response4 = await server.inject({
      method: 'POST',
      url: '/api/design/conversation/continue',
      headers: {
        'Content-Type': 'application/json',
        'x-chaincraft-api-key': apiKey!
      },
      payload: {
        conversationId,
        userMessage: 'Add a tournament mode where players compete in best-of-5 matches.'
      }
    });

    expect(response4.statusCode).toBe(200);
    const turn4 = JSON.parse(response4.payload);
    console.log(`✓ Status: ${response4.statusCode}`);
    console.log(`✓ Has Response: ${!!turn4.designResponse}`);
    console.log(`✓ Response Length: ${turn4.designResponse?.length || 0} chars`);
    console.log(`✓ Response Preview: ${turn4.designResponse?.substring(0, 100)}...`);
    
    expect(turn4.designResponse).toBeTruthy();
    expect(turn4.designResponse.length).toBeGreaterThan(0);

    // Turn 5: Force consolidation explicitly
    console.log('\n--- Turn 5: Force Consolidation ---');
    const response5 = await server.inject({
      method: 'POST',
      url: '/api/design/conversation/continue',
      headers: {
        'Content-Type': 'application/json',
        'x-chaincraft-api-key': apiKey!
      },
      payload: {
        conversationId,
        userMessage: 'Add achievements for reaching certain milestones.',
        forceSpecGeneration: true
      }
    });

    expect(response5.statusCode).toBe(200);
    const turn5 = JSON.parse(response5.payload);
    console.log(`✓ Status: ${response5.statusCode}`);
    console.log(`✓ Has Response: ${!!turn5.designResponse}`);
    console.log(`✓ Spec Generated: ${!!turn5.specification}`);
    console.log(`✓ Version: ${turn5.specification?.version || 'N/A'}`);
    console.log(`✓ Has Diff: ${!!turn5.specDiff}`);
    console.log(`✓ No Pending Changes: ${!turn5.pendingSpecChanges || turn5.pendingSpecChanges.length === 0}`);
    console.log(`✓ Response Preview: ${turn5.designResponse?.substring(0, 100)}...`);
    
    expect(turn5.designResponse).toBeTruthy();
    expect(turn5.designResponse.length).toBeGreaterThan(0);
    expect(turn5.specification).toBeTruthy();
    // Pending changes should be cleared after forced consolidation
    expect(turn5.pendingSpecChanges || []).toHaveLength(0);

    console.log('\n=== Test Complete ===');
    console.log('✓ All turns received responses');
    console.log('✓ No hanging requests during consolidation');
  }, 120000); // 2 minute timeout for LLM calls

  it('should retrieve conversation history after consolidation', async () => {
    conversationId = `test-history-${Date.now()}`;
    
    console.log(`\n=== Test: History Retrieval After Consolidation ===`);
    console.log(`Conversation ID: ${conversationId}\n`);

    // Create a conversation with consolidation
    await server.inject({
      method: 'POST',
      url: '/api/design/conversation/continue',
      headers: {
        'Content-Type': 'application/json',
        'x-chaincraft-api-key': apiKey!
      },
      payload: {
        conversationId,
        userMessage: 'Create a card game for 2-4 players.'
      }
    });

    // Add changes to trigger consolidation
    await server.inject({
      method: 'POST',
      url: '/api/design/conversation/continue',
      headers: {
        'Content-Type': 'application/json',
        'x-chaincraft-api-key': apiKey!
      },
      payload: {
        conversationId,
        userMessage: 'Add special action cards with detailed effects and costs. Include draw effects, discard effects, and point multipliers. Add rare legendary cards with unique abilities.',
        forceSpecGeneration: true
      }
    });

    // Now retrieve the history
    const historyResponse = await server.inject({
      method: 'POST',
      url: '/api/design/conversation/history',
      headers: {
        'Content-Type': 'application/json',
        'x-chaincraft-api-key': apiKey!
      },
      payload: {
        conversationId,
        page: 1,
        limit: 50
      }
    });

    expect(historyResponse.statusCode).toBe(200);
    const history = JSON.parse(historyResponse.payload);
    
    console.log(`✓ Status: ${historyResponse.statusCode}`);
    console.log(`✓ Total Messages: ${history.totalMessages}`);
    console.log(`✓ Messages Retrieved: ${history.messages?.length || 0}`);
    
    expect(history.conversationId).toBe(conversationId);
    expect(history.messages).toBeTruthy();
    expect(history.messages.length).toBeGreaterThan(0);
    expect(history.totalMessages).toBeGreaterThan(0);
    
    console.log('\n=== History Test Complete ===');
  }, 120000);

  it('should force spec generation via API endpoint', async () => {
    conversationId = `test-force-spec-${Date.now()}`;
    
    console.log(`\n=== Test: Force Spec Generation ===`);
    console.log(`Conversation ID: ${conversationId}\n`);

    // Step 1: Create conversation - this will auto-generate initial spec
    console.log('Step 1: Creating initial conversation (will auto-generate spec)...');
    const turn1 = await server.inject({
      method: 'POST',
      url: '/api/design/conversation/continue',
      headers: {
        'Content-Type': 'application/json',
        'x-chaincraft-api-key': apiKey!
      },
      payload: {
        conversationId,
        userMessage: 'Create a coin flip game for 2 players',
        gameDescription: 'Force Spec Test'
      }
    });

    expect(turn1.statusCode).toBe(200);
    const turn1Data = JSON.parse(turn1.payload);
    console.log(`✓ Turn 1 complete`);
    console.log(`✓ Has initial spec: ${!!turn1Data.designSpecification}`);

    // Step 2: Make a small change that creates pending changes
    console.log('Step 2: Making change (should create pending changes)...');
    const turn2 = await server.inject({
      method: 'POST',
      url: '/api/design/conversation/continue',
      headers: {
        'Content-Type': 'application/json',
        'x-chaincraft-api-key': apiKey!
      },
      payload: {
        conversationId,
        userMessage: 'Add a tie-breaker round if needed'
      }
    });

    expect(turn2.statusCode).toBe(200);
    const turn2Data = JSON.parse(turn2.payload);
    console.log(`✓ Turn 2 complete - Pending changes: ${turn2Data.pendingSpecChanges?.length || 0}`);
    
    // This should have pending changes OR already have an updated spec
    // (depending on whether router decided to consolidate)
    const hasPendingChanges = turn2Data.pendingSpecChanges && turn2Data.pendingSpecChanges.length > 0;
    console.log(`✓ Has pending changes: ${hasPendingChanges}`);

    // Step 3: Force spec generation (should work whether or not there are pending changes)
    console.log('Step 3: Forcing spec generation via API...');
    const forceSpecStart = Date.now();
    const forceSpecResponse = await server.inject({
      method: 'POST',
      url: '/api/design/conversation/generate-spec',
      headers: {
        'Content-Type': 'application/json',
        'x-chaincraft-api-key': apiKey!
      },
      payload: {
        conversationId
      }
    });
    const forceSpecElapsed = ((Date.now() - forceSpecStart) / 1000).toFixed(2);

    expect(forceSpecResponse.statusCode).toBe(200);
    const forceSpecData = JSON.parse(forceSpecResponse.payload);
    console.log(`✓ Force spec initiated in ${forceSpecElapsed}s`);
    console.log(`✓ Response: ${forceSpecData.message}`);
    console.log(`✓ Spec update in progress: ${forceSpecData.specUpdateInProgress}`);

    expect(forceSpecData.specUpdateInProgress).toBe(true);

    // Step 4: Wait and check for spec (spec generation takes ~30-40s)
    console.log('Step 4: Waiting 45s for background spec generation...');
    await new Promise(resolve => setTimeout(resolve, 45000));

    const cachedSpec = await server.inject({
      method: 'POST',
      url: '/api/design/conversation/specification/cached',
      headers: {
        'Content-Type': 'application/json',
        'x-chaincraft-api-key': apiKey!
      },
      payload: {
        conversationId
      }
    });

    expect(cachedSpec.statusCode).toBe(200);
    const cachedSpecData = JSON.parse(cachedSpec.payload);
    console.log(`✓ Spec generated: ${!!cachedSpecData.designSpecification}`);
    if (cachedSpecData.designSpecification) {
      console.log(`✓ Spec length: ${cachedSpecData.designSpecification.length} chars`);
      console.log(`✓ Spec version after force: ${cachedSpecData.version}`);
      console.log(`✓ Initial spec version was: ${turn1Data.version || 'unknown'}`);
      expect(cachedSpecData.designSpecification.length).toBeGreaterThan(0);
      // Spec version should have incremented (or stayed same if no changes)
      expect(cachedSpecData.version).toBeGreaterThanOrEqual(turn1Data.version || 1);
    } else {
      throw new Error('Force spec generation failed - no spec generated after 45s wait');
    }

    console.log('\n=== Force Spec Test Complete ===');
  }, 180000); // 3 minutes to allow for background spec generation
});
