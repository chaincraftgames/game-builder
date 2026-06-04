/**
 * Sim Assistant routes — SSE stream + message endpoint.
 *
 * Mounted under `/api/simulate` by the parent route registrar, so full paths are:
 *   GET  /api/simulate/:sessionId/assistant/stream   — SSE event stream
 *   POST /api/simulate/:sessionId/assistant/message   — send a user message (202)
 */
import { FastifyInstance } from 'fastify';
import {
  getOrCreateBus,
  appendBufferedEvent,
  getBufferedEventsSince,
  type SimAssistantEvent,
} from '#chaincraft/events/sim-assistant-bus.js';
import { handleAssistantMessage } from './handler.js';

export async function registerAssistantRoutes(server: FastifyInstance) {
  /**
   * SSE stream for sim assistant events.
   * Connect before sending the first message so no events are missed.
   */
  server.get<{ Params: { sessionId: string } }>(
    '/:sessionId/assistant/stream',
    async (request, reply) => {
      const { sessionId } = request.params;

      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      const bus = getOrCreateBus(sessionId);

      const send = (event: SimAssistantEvent) => {
        const id = appendBufferedEvent(sessionId, event);
        reply.raw.write(`id: ${id}\ndata: ${JSON.stringify(event)}\n\n`);
      };

      // Confirm stream is alive
      reply.raw.write(
        `data: ${JSON.stringify({ type: 'connected', sessionId })}\n\n`,
      );

      // Replay any events missed since the client's last-event-id (SSE reconnect)
      const lastEventIdHeader = request.headers['last-event-id'];
      if (lastEventIdHeader) {
        const afterId = parseInt(lastEventIdHeader as string, 10);
        if (!isNaN(afterId)) {
          const missed = getBufferedEventsSince(sessionId, afterId);
          for (const { id, event } of missed) {
            reply.raw.write(`id: ${id}\ndata: ${JSON.stringify(event)}\n\n`);
          }
        }
      }

      // Heartbeat every 15s to keep proxies from closing the connection
      const heartbeat = setInterval(() => {
        reply.raw.write(`data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`);
      }, 15_000);

      // Close the stream after 10 minutes of inactivity (no assistant events).
      // The client reconnects when needed; the graph resumes from its checkpoint.
      const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
      let inactivityTimer = setTimeout(closeStream, INACTIVITY_TIMEOUT_MS);

      let streamClosed = false;
      function closeStream() {
        if (streamClosed) return;
        streamClosed = true;
        clearInterval(heartbeat);
        clearTimeout(inactivityTimer);
        bus.off(wrappedSend);
        reply.raw.end();
      }

      // Wrap send to reset the inactivity timer on each event
      const wrappedSend = (event: SimAssistantEvent) => {
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(closeStream, INACTIVITY_TIMEOUT_MS);
        send(event);
      };

      bus.on(wrappedSend);

      request.raw.once('close', closeStream);
    },
  );

  /**
   * Send a message to the sim assistant.
   * Returns 202 immediately — the response arrives via the SSE stream.
   */
  server.post<{
    Params: { sessionId: string };
    Body: { message: string; gameId: string };
  }>(
    '/:sessionId/assistant/message',
    {
      schema: {
        params: {
          type: 'object',
          properties: { sessionId: { type: 'string' } },
          required: ['sessionId'],
        },
        body: {
          type: 'object',
          properties: {
            message: { type: 'string', minLength: 1 },
            gameId: { type: 'string', minLength: 1 },
          },
          required: ['message', 'gameId'],
        },
      },
    },
    async (request, reply) => {
      const { sessionId } = request.params;
      const { message, gameId } = request.body;

      // Fire and forget — response comes via SSE
      handleAssistantMessage(sessionId, gameId, message).catch((err) => {
        console.error(
          `[sim-assistant-route] Unhandled error for ${sessionId}:`,
          err,
        );
      });

      return reply.code(202).send({ status: 'accepted' });
    },
  );
}
