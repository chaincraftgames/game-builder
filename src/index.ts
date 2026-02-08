import 'dotenv/config';
import Fastify from 'fastify';
import { authenticate } from '#chaincraft/middleware/auth.js';
import { registerApiRoutes } from '#chaincraft/api/routes.js';
import { logApplicationEvent } from '#chaincraft/util/safe-logging.js';
import { cleanup } from '#chaincraft/ai/memory/checkpoint-memory.js';
import { getConfig } from '#chaincraft/config.js';

const server = Fastify({
  logger: true
});

// Add authentication hook for all routes except health check and internal endpoints
server.addHook('onRequest', async (request, reply) => {
  if (request.url === '/health') return;
  if (request.url === '/internal/cleanup') {
    // Internal endpoints use a separate auth token
    const token = request.headers['x-internal-token'];
    const expectedToken = process.env.CHAINCRAFT_INTERNAL_API_TOKEN;
    
    if (!expectedToken) {
      reply.code(500).send({ error: 'Internal API token not configured' });
      throw new Error('CHAINCRAFT_INTERNAL_API_TOKEN not set');
    }
    
    if (token !== expectedToken) {
      reply.code(401).send({ error: 'Unauthorized' });
      throw new Error('Invalid internal token');
    }
    return;
  }
  await authenticate(request, reply);
});

// Health check endpoint
server.get('/health', async () => {
  return { status: 'ok' };
});

// Internal cleanup endpoint for scheduled maintenance
// Call this from Railway cron with X-Internal-Token header
server.post('/internal/cleanup', async (request, reply) => {
  const startTime = Date.now();
  logApplicationEvent('cleanup', 'starting');
  
  try {
    // Clean up old simulation sessions (7+ days)
    // Design conversations are never auto-deleted - only when game is explicitly deleted
    await cleanup(getConfig('simulation-graph-type'), 7);
    
    const duration = Date.now() - startTime;
    logApplicationEvent('cleanup', 'completed', { durationMs: duration });
    
    return { 
      status: 'completed',
      durationMs: duration,
      cleanedTypes: ['simulation-workflow']
    };
  } catch (error) {
    logApplicationEvent('cleanup', 'failed', { error: String(error) });
    reply.code(500).send({ 
      error: 'Cleanup failed',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

const start = async () => {
  logApplicationEvent('web-api', 'starting');
  try {
    // Register API routes
    await registerApiRoutes(server);
    
    const port = parseInt(process.env.CHAINCRAFT_WEB_API_PORT || '3000', 10);
    const host = process.env.CHAINCRAFT_WEB_API_HOST || '0.0.0.0';

    await server.listen({ port, host });
    logApplicationEvent('web-api', 'started', { port, host });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
