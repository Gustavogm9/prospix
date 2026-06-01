import { Job } from 'bullmq';
import { BaseWorker } from './_base-worker.js';
import { dbAdmin } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';
import { searchPlaces } from '../integrations/google-maps.js';
import { getDecryptedSecrets } from '../tenant/secrets-vault.js';
import { createTenantQueue } from '../lib/queue.js';
import { BaseJobPayload } from '@prospix/shared-types';
import { LeadSource, LeadStatus } from '@prospix/shared-types';
import dayjs from 'dayjs';

export interface CaptureJobPayload extends BaseJobPayload {
  campaign_id: string;
  max_captures?: number;
}

export interface CaptureJobResult {
  captured: number;
  skipped: number;
  queriesRun: number;
  status: string;
  reason?: string;
}

const PROFESSION_QUERY_KEYWORDS: Record<string, string[]> = {
  DOCTOR: [
    'médico', 'clínica médica', 'consultório médico', 'clínica de saúde',
    'especialista médico', 'centro médico',
  ],
  LAWYER: [
    'advogado', 'escritório de advocacia', 'advocacia',
    'advogados associados', 'consultoria jurídica',
  ],
  DENTIST: [
    'dentista', 'clínica odontológica', 'consultório odontológico',
    'ortodontista', 'odontologia',
  ],
  ENTREPRENEUR: [
    'empresa', 'escritório', 'loja', 'comércio',
    'empreendedor', 'empresário', 'estabelecimento comercial',
  ],
  ENGINEER: [
    'engenheiro', 'escritório de engenharia', 'construtora',
    'engenharia civil',
  ],
  ARCHITECT: [
    'arquiteto', 'escritório de arquitetura', 'arquitetura e design',
    'arquitetura e urbanismo',
  ],
  ACCOUNTANT: [
    'contador', 'escritório de contabilidade', 'contabilidade',
    'assessoria contábil',
  ],
  OTHER: [
    'empresa', 'escritório', 'profissional',
  ],
};

function sanitizeWhatsapp(phone: string | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length === 0) return null;
  
  // If already has country code and is long enough
  if (digits.startsWith('55') && digits.length >= 12) {
    return digits;
  }
  
  // If national number with area code (e.g. 17998876622 or 1732321010)
  if (digits.length >= 10 && digits.length <= 11) {
    return `55${digits}`;
  }
  
  // Fallback: prepend 55 if not present
  if (digits.length < 12) {
    return `55${digits}`;
  }

  return digits;
}

export class CaptureGoogleMapsWorker extends BaseWorker<CaptureJobPayload, CaptureJobResult> {
  name = 'capture-google-maps';
  concurrency = 5; // allow up to 5 concurrent jobs

  async process(job: Job<CaptureJobPayload>): Promise<CaptureJobResult> {
    const { tenant_id: tenantId, campaign_id: campaignId, max_captures = 100 } = job.data;

    // 1. Distributed Lock to prevent duplicate concurrent runs
    const lockKey = `lock:capture:${tenantId}:${campaignId}`;
    const lockAcquired = await redis.set(lockKey, 'locked', 'EX', 600, 'NX'); // 10 minutes TTL
    
    if (!lockAcquired) {
      logger.info({ tenantId, campaignId }, 'Capture job already locked. Skipping.');
      return { captured: 0, skipped: 0, queriesRun: 0, status: 'skipped', reason: 'locked' };
    }

    try {
      // 2. Load and validate active campaign
      const { data: campaign, error: campErr } = await dbAdmin
        .from('campaigns')
        .select('*')
        .eq('id', campaignId)
        .single();

      if (campErr || !campaign || campaign.status !== 'ACTIVE') {
        logger.warn({ campaignId, status: campaign?.status }, 'Campaign not active or not found');
        return { captured: 0, skipped: 0, queriesRun: 0, status: 'skipped', reason: 'campaign_inactive_or_not_found' };
      }

      // 3. Check and respect daily limit
      const todayStart = dayjs().startOf('day').toDate();
      const { count: countToday } = await dbAdmin
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('campaign_id', campaign.id)
        .gte('created_at', todayStart.toISOString());

      const remainingLimit = Math.max(0, campaign.daily_limit - (countToday || 0));
      const allowedToCapture = Math.min(max_captures, remainingLimit);

      if (allowedToCapture <= 0) {
        logger.info({ campaignId, dailyLimit: campaign.daily_limit, countToday }, 'Campaign daily limit reached for today. Skipping.');
        return { captured: 0, skipped: 0, queriesRun: 0, status: 'skipped', reason: 'daily_limit_reached' };
      }

      // 4. Fetch Google Maps API Key (tenant own → platform shared fallback)
      const decryptedSecrets = await getDecryptedSecrets(tenantId);
      const apiKey = decryptedSecrets?.googleMapsApiKey || env.GOOGLE_MAPS_API_KEY;

      if (!apiKey) {
        logger.error({ tenantId }, 'Google Maps API Key not configured (no tenant key and no platform key)');
        return { captured: 0, skipped: 0, queriesRun: 0, status: 'failed', reason: 'api_key_missing' };
      }

      // 5. Build queries: multiple keywords × cities × neighborhoods
      const DEFAULT_KEYWORDS: string[] = ['empresa', 'escritório', 'profissional'];
      const keywords = PROFESSION_QUERY_KEYWORDS[campaign.profession] ?? DEFAULT_KEYWORDS;
      const queries: string[] = [];

      for (const keyword of keywords) {
        for (const city of (campaign.cities || []) as string[]) {
          if (campaign.neighborhoods && campaign.neighborhoods.length > 0) {
            for (const neighborhood of campaign.neighborhoods) {
              queries.push(`${keyword} ${neighborhood} ${city}`);
            }
          } else {
            queries.push(`${keyword} ${city}`);
          }
        }
      }

      let totalCaptured = 0;
      let totalSkipped = 0;
      let googleMapsCalls = 0;

      // 6. Execute capture search queries
      for (const query of queries) {
        if (totalCaptured >= allowedToCapture) {
          break;
        }

        logger.info({ campaignId, query }, 'Running place search query');
        googleMapsCalls++;
        
        const searchResult = await searchPlaces({
          query,
          apiKey,
          maxResults: allowedToCapture - totalCaptured,
        });

        if (!searchResult.ok) {
          logger.error({ error: searchResult.error, query }, 'Failed searching places');
          continue;
        }

        const places = searchResult.value;

        // Batch-load existing leads to avoid N+1 queries
        const batchWhatsapps = places
          .map(p => sanitizeWhatsapp(p.nationalPhoneNumber))
          .filter((w): w is string => w !== null);
        const batchExternalIds = places
          .map(p => p.placeId)
          .filter((id): id is string => !!id);

        const { data: existingByWhatsapp } = await dbAdmin
          .from('leads')
          .select('whatsapp')
          .eq('tenant_id', tenantId)
          .in('whatsapp', batchWhatsapps);
        const { data: existingByExtId } = await dbAdmin
          .from('leads')
          .select('source_external_id')
          .eq('tenant_id', tenantId)
          .in('source_external_id', batchExternalIds);

        const whatsappSet = new Set((existingByWhatsapp || []).map(l => l.whatsapp));
        const extIdSet = new Set((existingByExtId || []).map(l => l.source_external_id));

        for (const place of places) {
          if (totalCaptured >= allowedToCapture) {
            break;
          }

          const sanitisedPhone = sanitizeWhatsapp(place.nationalPhoneNumber);
          if (!sanitisedPhone) {
            totalSkipped++;
            continue; // Skip if no telephone (needed for WhatsApp outreach)
          }

          // Idempotency Check A: external_id collision per tenant (batch lookup)
          if (place.placeId && extIdSet.has(place.placeId)) {
            totalSkipped++;
            continue;
          }

          // Idempotency Check B: whatsapp duplicate per tenant (batch lookup)
          if (whatsappSet.has(sanitisedPhone)) {
            totalSkipped++;
            continue;
          }

          // Extract coordinates and address info if present
          let street = '';
          let neighborhood = '';
          let city = '';
          if (place.formattedAddress) {
            const parts = place.formattedAddress.split(',');
            street = parts[0]?.trim() || '';
            neighborhood = parts[1]?.trim() || '';
            city = parts[2]?.trim() || '';
          }

          // Insert Lead
          const { data: lead, error: leadErr } = await dbAdmin
            .from('leads')
            .insert({
              tenant_id: tenantId,
              campaign_id: campaign.id,
              source: LeadSource.GOOGLE_MAPS,
              source_external_id: place.placeId,
              source_raw_data: place as any,
              name: place.name,
              profession: campaign.profession,
              whatsapp: sanitisedPhone,
              address: {
                city,
                neighborhood,
                street,
              },
              google_rating: place.rating ? place.rating : null,
              google_reviews_count: place.userRatingCount ? place.userRatingCount : null,
              status: LeadStatus.CAPTURED,
            } as any)
            .select()
            .single();

          if (leadErr) throw leadErr;

          // Insert Lead Event
          const { error: eventErr } = await dbAdmin
            .from('lead_events')
            .insert({
              tenant_id: tenantId,
              lead_id: lead.id,
              event_type: 'captured',
              payload: {
                campaignId: campaign.id,
                query,
                source: 'google_maps',
              },
            } as any);
          if (eventErr) throw eventErr;

          totalCaptured++;
        }
      }

      // 7. Update Campaign totalCaptured count
      // Use rpc or raw increment since Supabase doesn't have { increment: N } syntax
      const { error: campUpdateErr } = await dbAdmin.rpc('increment_column' as any, {
        table_name: 'campaigns',
        column_name: 'total_captured',
        row_id: campaign.id,
        amount: totalCaptured,
      });

      // Fallback: if RPC doesn't exist, do a read-update
      if (campUpdateErr) {
        const newTotal = (campaign.total_captured || 0) + totalCaptured;
        await dbAdmin
          .from('campaigns')
          .update({ total_captured: newTotal })
          .eq('id', campaign.id);
      }

      // 8. Update Tenant usage
      const periodMonth = dayjs().startOf('month').toDate();
      const { data: existingUsage } = await dbAdmin
        .from('tenant_usage')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('period_month', periodMonth.toISOString())
        .single();

      if (existingUsage) {
        await dbAdmin
          .from('tenant_usage')
          .update({
            google_maps_calls: (existingUsage.google_maps_calls || 0) + googleMapsCalls,
            leads_captured_count: (existingUsage.leads_captured_count || 0) + totalCaptured,
          })
          .eq('tenant_id', tenantId)
          .eq('period_month', periodMonth.toISOString());
      } else {
        await dbAdmin
          .from('tenant_usage')
          .insert({
            tenant_id: tenantId,
            period_month: periodMonth.toISOString(),
            google_maps_calls: googleMapsCalls,
            leads_captured_count: totalCaptured,
          } as any);
      }

      logger.info(
        { campaignId, captured: totalCaptured, skipped: totalSkipped, calls: googleMapsCalls },
        'Capture google maps finished successfully'
      );

      // 9. Enqueue enrich-leads job to calculate fit scores and validate WhatsApp
      if (totalCaptured > 0) {
        const enrichQueue = createTenantQueue(tenantId, 'enrich-leads');
        try {
          await enrichQueue.add(
            'enrich-leads',
            {
              tenant_id: tenantId,
              trace_id: `capture-to-enrich:${campaignId}:${dayjs().format('YYYY-MM-DD-HH')}`,
            },
            { delay: 5000 } // 5s delay to let DB transaction settle
          );
          logger.info({ tenantId, campaignId, captured: totalCaptured }, 'Enqueued enrich-leads job for captured leads');
        } catch (enrichErr) {
          logger.error({ err: enrichErr, tenantId, campaignId }, 'Failed to enqueue enrich-leads job');
          // Don't fail the capture job because of enrich queue issue
        } finally {
          await enrichQueue.close();
        }
      }

      return {
        captured: totalCaptured,
        skipped: totalSkipped,
        queriesRun: googleMapsCalls,
        status: 'success',
      };
    } finally {
      // 9. Always release Redis lock
      await redis.del(lockKey);
    }
  }
}
