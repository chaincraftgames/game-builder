import 'dotenv/config';
import Fastify from 'fastify';
import { authenticate } from '#chaincraft/middleware/auth.js';
import { registerApiRoutes } from '#chaincraft/api/routes.js';
import { logApplicationEvent } from '#chaincraft/util/safe-logging.js';

const server = Fastify({
  logger: true
});

// Add authentication hook for all routes except health check
server.addHook('onRequest', async (request, reply) => {
  if (request.url === '/health') return;
  await authenticate(request, reply);
});

// Health check endpoint
server.get('/health', async () => {
  return { status: 'ok' };
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
