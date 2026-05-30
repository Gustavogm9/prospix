import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { redis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';

/**
 * Referral tracking routes.
 *
 * Uses Redis for lightweight referral tracking without requiring a DB migration.
 * Keys:
 *   referral:{tenantId}:clicks   — total link clicks (INCR)
 *   referral:{tenantId}:signups  — total signups via referral (INCR)
 *   referral:{tenantId}:history  — list of { type, timestamp, ip?, refCode }
 */
export const referralRoutes: FastifyPluginAsync = async (app) => {
  // GET /tenant/referrals — get referral stats for current tenant
  app.get('/', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    try {
      const refCode = tenantId.substring(0, 8);
      const clicks = parseInt(await redis.get(`referral:${tenantId}:clicks`) || '0', 10);
      const signups = parseInt(await redis.get(`referral:${tenantId}:signups`) || '0', 10);

      // Get recent referral events
      const historyRaw = await redis.lrange(`referral:${tenantId}:history`, 0, 19);
      const history = historyRaw.map((h: string) => {
        try { return JSON.parse(h); } catch { return null; }
      }).filter(Boolean);

      return reply.send({
        data: {
          refCode,
          link: `https://app.prospix.com.br/ref/${refCode}`,
          stats: {
            totalClicks: clicks,
            totalSignups: signups,
            conversionRate: clicks > 0 ? Math.round((signups / clicks) * 100) : 0,
          },
          recentActivity: history,
          rewards: {
            currentTier: signups >= 15 ? 'gold' : signups >= 5 ? 'silver' : 'bronze',
            nextTierAt: signups >= 15 ? null : signups >= 5 ? 15 : 5,
            benefits: signups >= 15
              ? ['1 mês grátis', '15% desconto permanente', 'Acesso prioritário']
              : signups >= 5
              ? ['15% desconto por 3 meses', 'Badge Silver']
              : ['5% desconto no próximo mês'],
          },
        },
      });
    } catch (err) {
      logger.error({ err }, 'Error fetching referral stats');
      return reply.status(500).send({ message: 'Failed to fetch referral data' });
    }
  });

  // POST /tenant/referrals/track — track a click or signup event
  const trackSchema = z.object({
    refCode: z.string().min(1),
    type: z.enum(['click', 'signup']).default('click'),
  });

  app.post('/track', async (request, reply) => {
    // Per-IP rate limiting: max 10 requests per minute
    const ip = request.ip;
    const rateLimitKey = `ratelimit:referral:${ip}`;
    const current = await redis.incr(rateLimitKey);
    if (current === 1) await redis.expire(rateLimitKey, 60); // 1 min window
    if (current > 10) {
      return reply.status(429).send({ message: 'Too many requests. Try again later.' });
    }

    const parsed = trackSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.errors[0]?.message ?? 'Invalid request body' });
    }
    const { refCode, type: eventType } = parsed.data;

    try {
      // Find tenant by refCode prefix — scan is needed since we store by tenantId
      // For now, use refCode directly as key prefix
      const key = `referral:by-code:${refCode}`;
      let tenantId = await redis.get(key);

      if (!tenantId) {
        // No mapping yet — this will be set when the tenant first views referrals
        return reply.status(404).send({ message: 'Invalid referral code' });
      }

      if (eventType === 'click') {
        await redis.incr(`referral:${tenantId}:clicks`);
      } else if (eventType === 'signup') {
        await redis.incr(`referral:${tenantId}:signups`);
      }

      // Store event in history
      await redis.lpush(`referral:${tenantId}:history`, JSON.stringify({
        type: eventType,
        timestamp: new Date().toISOString(),
        refCode,
      }));
      await redis.ltrim(`referral:${tenantId}:history`, 0, 49); // Keep last 50 events

      return reply.send({ success: true });
    } catch (err) {
      logger.error({ err }, 'Error tracking referral');
      return reply.status(500).send({ message: 'Failed to track referral' });
    }
  });

  // POST /tenant/referrals/register-code — register this tenant's refCode mapping
  app.post('/register-code', async (request, reply) => {
    const tenantId = (request as any).tenantId as string;
    try {
      const refCode = tenantId.substring(0, 8);
      await redis.set(`referral:by-code:${refCode}`, tenantId);
      return reply.send({ success: true, refCode });
    } catch (err) {
      logger.error({ err }, 'Error registering referral code');
      return reply.status(500).send({ message: 'Failed to register referral code' });
    }
  });
};
