import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
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
};

export default notificationsRoutes;
