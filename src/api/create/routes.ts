import { FastifyInstance } from 'fastify';
import { handleCreateGame } from './handler.js';
import { CreateGameRequestSchema, CreateGameResponseSchema } from '#chaincraft/api/create/schemas.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

export async function registerCreateRoutes(server: FastifyInstance) {
  server.post('/create', {
    schema: {
      body: zodToJsonSchema(CreateGameRequestSchema, 'createGameRequest'),
      response: {
        200: zodToJsonSchema(CreateGameResponseSchema, 'createGameResponse')
      }
    },
    handler: handleCreateGame,
  });
}
