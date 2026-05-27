import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { redis } from '../../lib/redis.js';
import { NotificationChannel } from '@prisma/client';

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
    
    const preferences = await prisma.notificationPreference.findMany({
      where: { userId },
    });

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
    
    const parseRes = upsertPreferenceSchema.safeParse(req.body);
    if (!parseRes.success) {
      return reply.code(400).send({ error: 'Validation Error', message: parseRes.error.errors[0]?.message });
    }

    const { eventType, channels, enabled } = parseRes.data;

    const preference = await prisma.notificationPreference.upsert({
      where: {
        userId_eventType: {
          userId,
          eventType,
        },
      },
      create: {
        userId,
        eventType,
        channels,
        enabled,
      },
      update: {
        channels,
        enabled,
      },
    });

    logger.info({ userId, eventType, channels }, 'Notification preference updated');
    return reply.send({ data: preference });
  });

  // GET /v1/tenant/notifications - List notifications for the logged user
  app.get('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.userId!, tenantId: req.tenantId! },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const unreadCount = await prisma.notification.count({
      where: { userId: req.userId!, tenantId: req.tenantId!, readAt: null },
    });

    return reply.send({ data: notifications, unreadCount });
  });

  // PATCH /v1/tenant/notifications/:id/read - Mark a notification as read
  app.patch('/:id/read', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    await prisma.notification.update({
      where: { id: req.params.id },
      data: { readAt: new Date() },
    });

    return reply.send({ success: true });
  });

  // POST /v1/tenant/notifications/read-all - Mark all notifications as read
  app.post('/read-all', async (req: FastifyRequest, reply: FastifyReply) => {
    await prisma.notification.updateMany({
      where: { userId: req.userId!, readAt: null },
      data: { readAt: new Date() },
    });

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
