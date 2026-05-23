import { Job } from 'bullmq';
import { BaseWorker } from './_base-worker.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { BaseJobPayload } from '@prospix/shared-types';
import { createEvolutionClient } from '../integrations/evolution.js';
import { env } from '../config/env.js';
import { UserRole, MeetingStatus } from '@prisma/client';

export interface DailyDigestPayload extends BaseJobPayload {
  // Cron payload
}

export interface DailyDigestResult {
  success: boolean;
  digests_sent: number;
}

export class DailyDigestWorker extends BaseWorker<DailyDigestPayload, DailyDigestResult> {
  name = 'daily-digest';
  concurrency = 1;

  async process(job: Job<DailyDigestPayload>): Promise<DailyDigestResult> {
    const activeTenants = await prisma.tenant.findMany({
      where: { id: job.data.tenant_id, status: 'ACTIVE', deletedAt: null },
    });

    let sentCount = 0;
    const evoClient = createEvolutionClient();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const yesterdayNight = new Date();
    yesterdayNight.setHours(yesterdayNight.getHours() - 15); // last 15h

    for (const tenant of activeTenants) {
      try {
        // 1. Fetch meetings today
        const meetingsToday = await prisma.meeting.findMany({
          where: {
            tenantId: tenant.id,
            scheduledFor: { gte: todayStart, lte: todayEnd },
            status: { in: [MeetingStatus.SCHEDULED, MeetingStatus.CONFIRMED] },
          },
          include: {
            lead: { select: { name: true } },
          },
          orderBy: { scheduledFor: 'asc' },
        });

        // 2. Fetch hot leads (fitScore >= 8.0, conversing or qualified)
        const hotLeads = await prisma.lead.findMany({
          where: {
            tenantId: tenant.id,
            fitScore: { gte: 8.0 },
            createdAt: { gte: yesterdayNight },
          },
          orderBy: { fitScore: 'desc' },
          take: 5,
        });

        // 3. Count last night captures
        const capturesCount = await prisma.lead.count({
          where: {
            tenantId: tenant.id,
            createdAt: { gte: yesterdayNight },
          },
        });

        // 4. Build text message
        let text = `*PROSPIX DIGEST MATINAL ☀️*\n\n`;
        text += `Bom dia! Aqui está o resumo operacional para o tenant *${tenant.name}* hoje:\n\n`;

        text += `*📅 Reuniões agendadas hoje (${meetingsToday.length}):*\n`;
        if (meetingsToday.length === 0) {
          text += `- Nenhuma reunião marcada para hoje.\n`;
        } else {
          meetingsToday.forEach((m) => {
            const time = new Date(m.scheduledFor).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            text += `- ${time}h: Reunião com *${m.lead?.name || 'Cliente'}* (${m.location || 'Google Meet'})\n`;
          });
        }
        text += `\n`;

        text += `*🔥 Oportunidades Quentes recentes (${hotLeads.length}):*\n`;
        if (hotLeads.length === 0) {
          text += `- Nenhuma nova oportunidade quente nas últimas 15 horas.\n`;
        } else {
          hotLeads.forEach((hl) => {
            text += `- *${hl.name || 'Lead s/ Nome'}* (Fit Score: ${Number(hl.fitScore).toFixed(1)})\n`;
          });
        }
        text += `\n`;

        text += `*📥 Captura da Noite Passada:*\n`;
        text += `- *${capturesCount}* novos leads foram capturados nas últimas 15 horas!\n\n`;
        text += `Boas vendas e bons negócios! 🚀`;

        // 5. Fetch Tenant Owner to send the message
        const owner = await prisma.user.findFirst({
          where: {
            tenantId: tenant.id,
            role: UserRole.OWNER,
            deletedAt: null,
          },
        });

        if (owner && owner.whatsapp) {
          // Send to the owner via Prospix master guilds instance
          const res = await evoClient.sendText({
            baseUrl: env.EVOLUTION_BASE_URL,
            apiKey: env.EVOLUTION_GUILDS_API_KEY,
            instance: env.EVOLUTION_GUILDS_INSTANCE,
            number: owner.whatsapp.replace(/\D/g, ''),
            text,
          });

          if (res.ok) {
            sentCount++;
            logger.info({ tenant_id: tenant.id, user_id: owner.id }, 'Daily digest sent successfully');
          } else {
            logger.error({ tenant_id: tenant.id, err: res.error }, 'Failed to send daily digest');
          }
        }
      } catch (err) {
        logger.error({ tenant_id: tenant.id, err }, 'Exception compiling daily digest');
      }
    }

    return {
      success: true,
      digests_sent: sentCount,
    };
  }
}
