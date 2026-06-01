import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDb } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { redis } from '../../lib/redis.js';
import { NotificationChannel } from '@prospix/shared-types';

export const notificationsRoutes: FastifyPluginAsync = async (app) => {
  // Enforce auth
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.userId) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'User context is required' });
    }
  });

  // GET /v1/tenant/notifications/preferences - Get notification preferences for logged user
  app.get('/preferences', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.userId!;
    const db = getDb(req);

    const { data: preferences, error } = await db
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId);

    if (error) throw error;

    return reply.send({ data: preferences });
  });

  // PUT /v1/tenant/notifications/preferences - Upsert notification preferences
  const upsertPreferenceSchema = z.object({
    eventType: z.string().min(1, 'Event type is required'),
    channels: z.array(z.nativeEnum(NotificationChannel)).min(1, 'At least one channel is required'),
    enabled: z.boolean().default(true),
  });

  app.put('/preferences', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.userId!;
    const db = getDb(req);

    const parseRes = upsertPreferenceSchema.safeParse(req.body);
    if (!parseRes.success) {
      return reply.code(400).send({ error: 'Validation Error', message: parseRes.error.errors[0]?.message });
    }

    const { eventType, channels, enabled } = parseRes.data;

    // Check if preference exists for this user+eventType
    const { data: existing } = await db
      .from('notification_preferences')
      .select('id')
      .eq('user_id', userId)
      .eq('event_type', eventType)
      .maybeSingle();

    let preference;
    if (existing) {
      const { data, error } = await db
        .from('notification_preferences')
        .update({
          channels,
          enabled,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;
      preference = data;
    } else {
      const { data, error } = await db
        .from('notification_preferences')
        .insert({
          id: crypto.randomUUID(),
          user_id: userId,
          event_type: eventType,
          channels,
          enabled,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      preference = data;
    }

    logger.info({ userId, eventType, channels }, 'Notification preference updated');
    return reply.send({ data: preference });
  });

  // GET /v1/tenant/notifications - List notifications for the logged user
  app.get('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const db = getDb(req);

    const [notifRes, countRes] = await Promise.all([
      db.from('notifications')
        .select('*')
        .eq('user_id', req.userId!)
        .eq('tenant_id', req.tenantId!)
        .order('created_at', { ascending: false })
        .limit(20),
      db.from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', req.userId!)
        .eq('tenant_id', req.tenantId!)
        .is('read_at', null),
    ]);

    if (notifRes.error) throw notifRes.error;

    return reply.send({ data: notifRes.data, unreadCount: countRes.count ?? 0 });
  });

  // PATCH /v1/tenant/notifications/:id/read - Mark a notification as read
  const idParamSchema = z.object({ id: z.string().uuid('Invalid ID format — expected UUID') });

  app.patch('/:id/read', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const paramsParsed = idParamSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      return reply.code(400).send({ error: 'Validation Error', message: paramsParsed.error.errors[0]?.message });
    }

    const db = getDb(req);
    const { error } = await db
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', paramsParsed.data.id)
      .eq('tenant_id', req.tenantId!);

    if (error) throw error;

    return reply.send({ success: true });
  });

  // POST /v1/tenant/notifications/read-all - Mark all notifications as read
  app.post('/read-all', async (req: FastifyRequest, reply: FastifyReply) => {
    const db = getDb(req);
    const { error } = await db
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', req.userId!)
      .eq('tenant_id', req.tenantId!)
      .is('read_at', null);

    if (error) throw error;

    return reply.send({ success: true });
  });

  // POST /v1/tenant/notifications/push-subscription - Store web push subscription
  app.post('/push-subscription', async (req: FastifyRequest, reply: FastifyReply) => {
    await redis.set(`push:${req.userId}`, JSON.stringify(req.body), 'EX', 30 * 24 * 60 * 60);

    logger.info({ userId: req.userId }, 'Push subscription stored');
    return reply.send({ success: true });
  });
};

export default notificationsRoutes;
