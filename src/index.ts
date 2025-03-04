import 'dotenv/config';
import Fastify from 'fastify';
import { authenticate } from '#chaincraft/middleware/auth.js';
import { registerCreateRoutes } from '#chaincraft/api/create/routes.js';

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
  console.info('Starting ChainCraft GameBuilder server...');
  try {
    // Register routes
    await registerCreateRoutes(server);
    
    await server.listen({ port: 3000 });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
