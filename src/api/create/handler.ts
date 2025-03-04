import { FastifyRequest, FastifyReply } from 'fastify';
import { CreateGameRequest, CreateGameRequestSchema, CreateGameResponse } from '#chaincraft/api/create/schemas.js';

export async function handleCreateGame(
  request: FastifyRequest<{ Body: CreateGameRequest }>,
  reply: FastifyReply
): Promise<CreateGameResponse> {
  const result = CreateGameRequestSchema.safeParse(request.body);
  
  if (!result.success) {
    reply.code(400).send({ error: 'Invalid request', details: result.error });
    return Promise.reject();
  }

  // TODO: Add actual game creation logic here
  // For now, just echo back the description
  return {
    gameDescription: result.data.description,
  };
}
