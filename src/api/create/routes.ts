import { FastifyInstance } from 'fastify';
import {
  getOrCreateBus,
  type GameCreationStatusEvent,
} from '#chaincraft/events/game-creation-status-bus.js';

export async function registerCreateRoutes(server: FastifyInstance) {
  /**
   * SSE endpoint for game creation status.
   * The frontend should connect here *before* calling POST /api/simulate/create
   * so that artifact progress events are not missed.
   *
   * Events: 
   *         spec:started, spec:completed, spec:error,
   *         artifact:started, artifact:completed, artifact:error,
   *         repair:started, repair:completed,
   *         generation:completed, generation:error
   */
  server.get<{ Params: { gameId: string } }>('/:gameId/status', async (request, reply) => {
    const { gameId } = request.params;

    // Hijack the response so Fastify doesn't try to finalize it after the handler returns
    reply.hijack();

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const bus = getOrCreateBus(gameId);

    const send = (event: GameCreationStatusEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // Send a connected ping immediately so the client can verify the stream is alive
    reply.raw.write(`data: ${JSON.stringify({ type: 'connected', gameId })}\n\n`);

    bus.on(send);

    request.raw.once('close', () => {
      bus.off(send);
      reply.raw.end();
    });
  });
}
