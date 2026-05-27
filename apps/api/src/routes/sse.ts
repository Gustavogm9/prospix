/**
 * SSE (Server-Sent Events) endpoint for real-time notifications.
 *
 * GET /v1/sse/events?tenantId={id}
 *
 * The frontend connects with an EventSource and receives JSON events
 * when messages are created/updated and conversations change.
 *
 * Requires valid JWT Bearer token in the Authorization header.
 * Since EventSource doesn't support headers, the frontend should use
 * a custom implementation with fetch() instead of native EventSource.
 */
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { subscribeToTenant, RealtimeEvent } from '../lib/realtime.js';
import { logger } from '../lib/logger.js';

export const sseRoutes: FastifyPluginAsync = async (app) => {
  app.get('/events', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (req as any).tenantId || (req.query as any)?.tenantId;
    if (!tenantId) {
      return reply.status(400).send({ message: 'tenantId is required' });
    }

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    // Send initial connection event
    reply.raw.write(`data: ${JSON.stringify({ type: 'connected', tenantId })}\n\n`);

    // Heartbeat every 30s to keep connection alive
    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n');
    }, 30000);

    // Subscribe to tenant events via Redis pub/sub
    const unsubscribe = subscribeToTenant(tenantId, (event: RealtimeEvent) => {
      try {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
      } catch {
        // Client disconnected
      }
    });

    logger.info({ tenantId }, 'sse:client-connected');

    // Cleanup on disconnect
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      logger.info({ tenantId }, 'sse:client-disconnected');
    });

    // Don't let Fastify send a response — we're streaming
    return reply;
  });
};

export default sseRoutes;
