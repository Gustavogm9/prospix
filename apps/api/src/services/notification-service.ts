import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';
import { createEvolutionClient } from '../integrations/evolution.js';
import { NotificationChannel } from '@prisma/client';

export interface SendNotificationParams {
  tenantId: string;
  userId: string;
  type: string; // ex: 'meeting_scheduled', 'ai_quota_70', 'billing_suspension'
  title: string;
  body: string;
  data?: any;
  link?: string;
}

/**
 * Dispatches a notification to all enabled channels based on user preferences.
 */
export async function sendNotification(params: SendNotificationParams): Promise<void> {
  const { tenantId, userId, type, title, body, data, link } = params;

  try {
    // 1. Fetch User details
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.deletedAt) {
      logger.warn({ userId }, 'User not found or deleted, skipping notification dispatch');
      return;
    }

    // 2. Fetch User Notification Preferences
    const pref = await prisma.notificationPreference.findUnique({
      where: {
        userId_eventType: {
          userId,
          eventType: type,
        },
      },
    });

    // Default channels to use if no preferences set
    const channels = pref?.enabled !== false
      ? (pref?.channels || [NotificationChannel.PUSH, NotificationChannel.EMAIL])
      : [];

    logger.info({ userId, type, channels }, 'Dispatching notification across channels');

    // 3. Channel: PUSH
    if (channels.includes(NotificationChannel.PUSH)) {
      try {
        await prisma.notification.create({
          data: {
            tenantId,
            userId,
            type,
            title,
            body,
            data: data ? JSON.stringify(data) : undefined,
            link,
          },
        });
      } catch (err) {
        logger.error({ err, userId }, 'Failed to create in-app notification record');
      }
    }

    // 4. Channel: EMAIL
    if (channels.includes(NotificationChannel.EMAIL) && user.email && env.RESEND_API_KEY) {
      try {
        // Envia via Resend REST API de forma isolada
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: 'Prospix AI <noreply@prospix.com>',
            to: user.email,
            subject: title,
            html: `<div style="font-family: sans-serif; max-width: 600px; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
              <h2 style="color: #4f46e5;">${title}</h2>
              <p style="font-size: 16px; color: #333;">${body}</p>
              ${link ? `<a href="${link}" style="display: inline-block; background: #4f46e5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-top: 15px;">Acessar Painel</a>` : ''}
              <hr style="border: 0; border-top: 1px solid #eee; margin-top: 30px;">
              <p style="font-size: 12px; color: #999;">Esta é uma mensagem automática enviada por Prospix. Não responda a este email.</p>
            </div>`,
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          logger.error({ status: res.status, body: errText }, 'Resend email dispatch failed');
        }
      } catch (err) {
        logger.error({ err, email: user.email }, 'Failed to send notification email');
      }
    }

    // 5. Channel: WHATSAPP
    if (channels.includes(NotificationChannel.WHATSAPP) && user.whatsapp && env.EVOLUTION_GUILDS_API_KEY) {
      try {
        const evoClient = createEvolutionClient();
        await evoClient.sendText({
          baseUrl: env.EVOLUTION_BASE_URL,
          apiKey: env.EVOLUTION_GUILDS_API_KEY,
          instance: env.EVOLUTION_GUILDS_INSTANCE,
          number: user.whatsapp.replace(/\D/g, ''),
          text: `*${title}*\n\n${body}${link ? `\n\nLink: ${link}` : ''}`,
        });
      } catch (err) {
        logger.error({ err, whatsapp: user.whatsapp }, 'Failed to send notification WhatsApp');
      }
    }

  } catch (err) {
    logger.error({ err, userId, type }, 'Fatal error during notification dispatch process');
  }
}
