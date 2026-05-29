import { Job } from 'bullmq';
import { BaseWorker } from './_base-worker.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';
import { searchPlaces } from '../integrations/google-maps.js';
import { getDecryptedSecrets } from '../tenant/secrets-vault.js';
import { BaseJobPayload } from '@prospix/shared-types';
import { LeadSource, LeadStatus } from '@prisma/client';
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

const PROFESSION_TRANSLATIONS: Record<string, string> = {
  DOCTOR: 'médico',
  LAWYER: 'advogado',
  DENTIST: 'dentista',
  ENTREPRENEUR: 'empresário',
  ENGINEER: 'engenheiro',
  ARCHITECT: 'arquiteto',
  ACCOUNTANT: 'contador',
  OTHER: 'profissional',
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
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
      });

      if (!campaign || campaign.status !== 'ACTIVE') {
        logger.warn({ campaignId, status: campaign?.status }, 'Campaign not active or not found');
        return { captured: 0, skipped: 0, queriesRun: 0, status: 'skipped', reason: 'campaign_inactive_or_not_found' };
      }

      // 3. Check and respect daily limit
      const todayStart = dayjs().startOf('day').toDate();
      const countToday = await prisma.lead.count({
        where: {
          campaignId: campaign.id,
          createdAt: { gte: todayStart },
        },
      });

      const remainingLimit = Math.max(0, campaign.dailyLimit - countToday);
      const allowedToCapture = Math.min(max_captures, remainingLimit);

      if (allowedToCapture <= 0) {
        logger.info({ campaignId, dailyLimit: campaign.dailyLimit, countToday }, 'Campaign daily limit reached for today. Skipping.');
        return { captured: 0, skipped: 0, queriesRun: 0, status: 'skipped', reason: 'daily_limit_reached' };
      }

      // 4. Fetch Google Maps API Key (tenant own → platform shared fallback)
      const decryptedSecrets = await getDecryptedSecrets(tenantId);
      const apiKey = decryptedSecrets?.googleMapsApiKey || env.GOOGLE_MAPS_API_KEY;

      if (!apiKey) {
        logger.error({ tenantId }, 'Google Maps API Key not configured (no tenant key and no platform key)');
        return { captured: 0, skipped: 0, queriesRun: 0, status: 'failed', reason: 'api_key_missing' };
      }

      // 5. Build queries: {profession} {city} + neighborhoods
      const professionTranslated = PROFESSION_TRANSLATIONS[campaign.profession] || 'profissional';
      const queries: string[] = [];

      for (const city of campaign.cities) {
        if (campaign.neighborhoods && campaign.neighborhoods.length > 0) {
          for (const neighborhood of campaign.neighborhoods) {
            queries.push(`${professionTranslated} ${neighborhood} ${city}`);
          }
        } else {
          queries.push(`${professionTranslated} ${city}`);
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

        for (const place of places) {
          if (totalCaptured >= allowedToCapture) {
            break;
          }

          const sanitisedPhone = sanitizeWhatsapp(place.nationalPhoneNumber);
          if (!sanitisedPhone) {
            totalSkipped++;
            continue; // Skip if no telephone (needed for WhatsApp outreach)
          }

          // Idempotency Check A: external_id collision per tenant
          const externalIdExists = await prisma.lead.findFirst({
            where: {
              tenantId,
              sourceExternalId: place.placeId,
            },
          });

          if (externalIdExists) {
            totalSkipped++;
            continue;
          }

          // Idempotency Check B: whatsapp duplicate per tenant
          const whatsappExists = await prisma.lead.findFirst({
            where: {
              tenantId,
              whatsapp: sanitisedPhone,
            },
          });

          if (whatsappExists) {
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

          // Insert Lead and Lead Event
          await prisma.$transaction(async (tx) => {
            const lead = await tx.lead.create({
              data: {
                tenantId,
                campaignId: campaign.id,
                source: LeadSource.GOOGLE_MAPS,
                sourceExternalId: place.placeId,
                sourceRawData: place as any,
                name: place.name,
                profession: campaign.profession,
                whatsapp: sanitisedPhone,
                address: {
                  city,
                  neighborhood,
                  street,
                },
                googleRating: place.rating ? place.rating : null,
                googleReviewsCount: place.userRatingCount ? place.userRatingCount : null,
                status: LeadStatus.CAPTURED,
              },
            });

            await tx.leadEvent.create({
              data: {
                tenantId,
                leadId: lead.id,
                eventType: 'captured',
                payload: {
                  campaignId: campaign.id,
                  query,
                  source: 'google_maps',
                },
              },
            });
          });

          totalCaptured++;
        }
      }

      // 7. Update Campaign totalCaptured count
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          totalCaptured: { increment: totalCaptured },
        },
      });

      // 8. Update Tenant usage
      const periodMonth = dayjs().startOf('month').toDate();
      await prisma.tenantUsage.upsert({
        where: {
          tenantId_periodMonth: {
            tenantId,
            periodMonth,
          },
        },
        create: {
          tenantId,
          periodMonth,
          googleMapsCalls,
          leadsCapturedCount: totalCaptured,
        },
        update: {
          googleMapsCalls: { increment: googleMapsCalls },
          leadsCapturedCount: { increment: totalCaptured },
        },
      });

      logger.info(
        { campaignId, captured: totalCaptured, skipped: totalSkipped, calls: googleMapsCalls },
        'Capture google maps finished successfully'
      );

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
