import { FastifyRequest, FastifyReply } from 'fastify';

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const apiKey = request.headers['x-chaincraft-api-key'];
  console.debug('[Auth] headers', request.headers);

  if (!apiKey || apiKey !== process.env.CHAINCRAFT_GAMEBUILDER_API_KEY) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }
}
