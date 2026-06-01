import { FastifyRequest, FastifyReply, FastifyPluginAsync } from 'fastify';
import { dbAdmin } from '../lib/db.js';
import { logger } from '../lib/logger.js';

/**
 * Fastify Idempotency Middleware.
 * Caches and replays response payloads based on the X-Idempotency-Key header.
 */
export const idempotencyPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    // Only run on side-effect methods
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return;
    }

    const key = req.headers['x-idempotency-key'] || req.headers['idempotency-key'];
    if (!key || typeof key !== 'string') {
      return; // Optional: let the request pass directly
    }

    // Tenant context could be attached by tenantContext middleware
    const tenantId = (req as any).tenantId || null;

    try {
      const { data: cached } = await dbAdmin
        .from('idempotency_keys')
        .select('*')
        .eq('key', key)
        .single();

      if (cached) {
        // Check if expired
        if (new Date(cached.expires_at) < new Date()) {
          // Clean up expired key
          await dbAdmin
            .from('idempotency_keys')
            .delete()
            .eq('key', key);
        } else if (cached.response_cache !== null) {
          // Replay cached response
          logger.info({ key, endpoint: req.url }, '♻️ Idempotency: Replaying cached response');
          
          return reply
            .code(cached.status_code || 200)
            .header('X-Cache-Lookup', 'HIT - Idempotency')
            .send(cached.response_cache);
        } else {
          // Pending request in progress
          logger.warn({ key }, '⏳ Idempotency: Request already in progress');
          return reply.code(409).send({
            error: 'Conflict',
            message: 'A request with this idempotency key is already in progress.',
          });
        }
      }

      // No cached key -> mark as pending
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h default TTL
      const { error: insertErr } = await dbAdmin
        .from('idempotency_keys')
        .insert({
          key,
          tenant_id: tenantId,
          endpoint: req.url,
          response_cache: null as any,
          status_code: null,
          expires_at: expiresAt.toISOString(),
        });

      if (insertErr) throw insertErr;

      // Attach key to request so onSend hook knows to cache it
      (req as any).idempotencyKey = key;
    } catch (err) {
      logger.error({ err, key }, '❌ Idempotency preHandler error');
      // Graceful degradation: let request proceed even if idempotency checks fail
    }
  });

  app.addHook('onSend', async (req: FastifyRequest, reply: FastifyReply, payload: any) => {
    const key = (req as any).idempotencyKey;
    if (!key) return payload;

    const statusCode = reply.statusCode;

    // Do not cache transient server errors (5xx)
    if (statusCode >= 500) {
      try {
        await dbAdmin
          .from('idempotency_keys')
          .delete()
          .eq('key', key);
      } catch (_) {}
      return payload;
    }

    try {
      let parsedPayload: any = null;
      if (typeof payload === 'string') {
        try {
          parsedPayload = JSON.parse(payload);
        } catch (_) {
          parsedPayload = { text: payload };
        }
      } else if (payload && typeof payload === 'object') {
        parsedPayload = payload;
      }

      const { error: updateErr } = await dbAdmin
        .from('idempotency_keys')
        .update({
          response_cache: parsedPayload ?? {},
          status_code: statusCode,
        })
        .eq('key', key);

      if (updateErr) throw updateErr;
    } catch (err) {
      logger.error({ err, key }, '❌ Idempotency onSend cache save error');
    }

    return payload;
  });
};

(idempotencyPlugin as any)[Symbol.for('skip-override')] = true;

export default idempotencyPlugin;
