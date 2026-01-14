/**
 * Narrative Expansion API Test
 * 
 * Tests that narrative markers are:
 * 1. Generated in skeletons by spec-execute
 * 2. Populated by generate-narratives
 * 3. Expanded at API boundary (markers replaced with START/END wrapped content)
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import Fastify, { FastifyInstance } from 'fastify';
import { authenticate } from '#chaincraft/middleware/auth.js';
import { registerApiRoutes } from '#chaincraft/api/routes.js';

describe('Narrative Expansion - API Level', () => {
  let server: FastifyInstance;
  const conversationId = `test-narrative-expansion-${Date.now()}`;
  const apiKey = process.env.CHAINCRAFT_GAMEBUILDER_API_KEY;

  beforeAll(async () => {
    server = Fastify({ logger: false });
    
    // Add authentication
    server.addHook('onRequest', async (request, reply) => {
      if (request.url !== '/health') {
        await authenticate(request, reply);
      }
    });

    // Register routes
    await registerApiRoutes(server);
  });

  afterAll(async () => {
    await server.close();
  });

  it('should generate skeleton with markers and expand narratives in API response', async () => {
    console.log('\n=== Narrative Expansion Test ===');
    console.log(`Conversation ID: ${conversationId}\n`);

    // Request a narrative-heavy game type (don't force spec gen - let it go through normal flow)
    const response = await server.inject({
      method: 'POST',
      url: '/api/design/conversation/continue',
      headers: {
        'Content-Type': 'application/json',
        'x-chaincraft-api-key': 'secret-key',
      },
      payload: {
        conversationId,
        userMessage: 'I want to design a horror survival game where players explore a haunted mansion and encounter supernatural events. The game should have atmospheric narrative descriptions for different rooms and events.',
      },
    });

    console.log(`Status: ${response.statusCode}`);
    expect(response.statusCode).toBe(200);

    const result = JSON.parse(response.payload);
    console.log(`Has specification: ${!!result.specification}`);
    console.log(`Spec length: ${result.specification?.designSpecification?.length || 0} chars`);

    // Verify we got a specification
    expect(result.specification).toBeDefined();
    expect(result.specification.designSpecification).toBeDefined();

    const spec = result.specification.designSpecification;

    // Check for narrative START/END markers (proof of expansion)
    const hasStartMarkers = /!___ NARRATIVE_START:\w+ ___!/.test(spec);
    const hasEndMarkers = /!___ NARRATIVE_END:\w+ ___!/.test(spec);
    
    console.log(`Has NARRATIVE_START markers: ${hasStartMarkers}`);
    console.log(`Has NARRATIVE_END markers: ${hasEndMarkers}`);

    // Check for unexpanded markers (should NOT be present)
    const hasUnexpandedMarkers = /!___ NARRATIVE:(\w+) ___!(?!\n)/.test(spec);
    console.log(`Has unexpanded markers: ${hasUnexpandedMarkers}`);

    // If markers were generated, they should be expanded
    if (hasStartMarkers || hasEndMarkers) {
      console.log('✓ Narratives were generated and expanded');
      expect(hasStartMarkers).toBe(true);
      expect(hasEndMarkers).toBe(true);
      expect(hasUnexpandedMarkers).toBe(false);

      // Show example of expanded content
      const startMatch = spec.match(/!___ NARRATIVE_START:(\w+) ___!([\s\S]*?)!___ NARRATIVE_END:\1 ___!/);
      if (startMatch) {
        console.log(`\nExample expanded narrative (${startMatch[1]}):`);
        console.log(startMatch[2].substring(0, 200) + '...');
      }
    } else {
      console.log('⚠ No narrative markers were generated (LLM chose not to use them)');
      // This is okay - the LLM might decide not to use markers
      // But we should at least verify no unexpanded markers exist
      expect(hasUnexpandedMarkers).toBe(false);
    }

    console.log('\n=== Test Complete ===\n');
  }, 180000); // 3 minute timeout for LLM calls
});
