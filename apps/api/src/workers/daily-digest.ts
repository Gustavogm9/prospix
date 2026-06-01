import { Job } from 'bullmq';
import { BaseWorker } from './_base-worker.js';
import { dbAdmin } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { BaseJobPayload } from '@prospix/shared-types';
import { createEvolutionClient } from '../integrations/evolution.js';
import { env } from '../config/env.js';
import { UserRole, MeetingStatus } from '@prospix/shared-types';

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
    const { data: activeTenants, error: tenantErr } = await dbAdmin
      .from('tenants')
      .select('*')
      .eq('id', job.data.tenant_id)
      .eq('status', 'ACTIVE')
      .is('deleted_at', null);

    if (tenantErr) throw tenantErr;

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
        const { data: meetingsToday } = await dbAdmin
          .from('meetings')
          .select('*, leads(name)')
          .eq('tenant_id', tenant.id)
          .gte('scheduled_for', todayStart.toISOString())
          .lte('scheduled_for', todayEnd.toISOString())
          .in('status', [MeetingStatus.SCHEDULED, MeetingStatus.CONFIRMED])
          .order('scheduled_for', { ascending: true });

        // 2. Fetch hot leads (fitScore >= 8.0, conversing or qualified)
        const { data: hotLeads } = await dbAdmin
          .from('leads')
          .select('*')
          .eq('tenant_id', tenant.id)
          .gte('fit_score', 8.0)
          .gte('created_at', yesterdayNight.toISOString())
          .order('fit_score', { ascending: false })
          .limit(5);

        // 3. Count last night captures
        const { count: capturesCount } = await dbAdmin
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenant.id)
          .gte('created_at', yesterdayNight.toISOString());

        // 4. Build text message
        const meetings = meetingsToday || [];
        const leads = hotLeads || [];
        const captures = capturesCount || 0;

        let text = `*PROSPIX DIGEST MATINAL ☀️*\n\n`;
        text += `Bom dia! Aqui está o resumo operacional para o tenant *${tenant.name}* hoje:\n\n`;

        text += `*📅 Reuniões agendadas hoje (${meetings.length}):*\n`;
        if (meetings.length === 0) {
          text += `- Nenhuma reunião marcada para hoje.\n`;
        } else {
          meetings.forEach((m: any) => {
            const time = new Date(m.scheduled_for).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            text += `- ${time}h: Reunião com *${m.leads?.name || 'Cliente'}* (${m.location || 'Google Meet'})\n`;
          });
        }
        text += `\n`;

        text += `*🔥 Oportunidades Quentes recentes (${leads.length}):*\n`;
        if (leads.length === 0) {
          text += `- Nenhuma nova oportunidade quente nas últimas 15 horas.\n`;
        } else {
          leads.forEach((hl: any) => {
            text += `- *${hl.name || 'Lead s/ Nome'}* (Fit Score: ${Number(hl.fit_score).toFixed(1)})\n`;
          });
        }
        text += `\n`;

        text += `*📊 Captura da Noite Passada:*\n`;
        text += `- *${captures}* novos leads foram capturados nas últimas 15 horas!\n\n`;
        text += `Boas vendas e bons negócios! 🚀`;

        // 5. Fetch Tenant Owner to send the message
        const { data: owner } = await dbAdmin
          .from('users')
          .select('id, whatsapp')
          .eq('tenant_id', tenant.id)
          .eq('role', UserRole.OWNER)
          .is('deleted_at', null)
          .limit(1)
          .single();

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
