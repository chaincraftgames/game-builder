import { FastifyInstance } from 'fastify';
import { registerDesignRoutes } from '#chaincraft/api/design/routes.js';
import { registerSimulateRoutes } from '#chaincraft/api/simulate/routes.js';
import { registerInternalRoutes } from '#chaincraft/api/internal/routes.js';

export async function registerApiRoutes(server: FastifyInstance) {
  // Register design API routes under /api/design
  await server.register(async function (fastify) {
    await registerDesignRoutes(fastify);
  }, { prefix: '/api/design' });

  // Register simulate API routes under /api/simulate
  await server.register(async function (fastify) {
    await registerSimulateRoutes(fastify);
  }, { prefix: '/api/simulate' });

  // Register internal API routes under /internal (admin/ops endpoints)
  await server.register(async function (fastify) {
    await registerInternalRoutes(fastify);
  }, { prefix: '/internal' });
}
