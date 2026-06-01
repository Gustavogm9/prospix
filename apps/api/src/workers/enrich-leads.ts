import { Job } from 'bullmq';
import { BaseWorker } from './_base-worker.js';
import { dbAdmin } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { checkPhone } from '../integrations/evolution.js';
import { getCnpjInfo } from '../integrations/brasilapi.js';
import { calculateFitScore } from '../domain/fit-score.js';
import { getDecryptedSecrets } from '../tenant/secrets-vault.js';
import { BaseJobPayload } from '@prospix/shared-types';
import { LeadStatus } from '@prospix/shared-types';
import dayjs from 'dayjs';

export interface EnrichLeadsPayload extends BaseJobPayload {
  lead_ids?: string[];
}

export interface EnrichLeadsResult {
  processed: number;
  enriched: number;
  archived: number;
  failed: number;
}

export class EnrichLeadsWorker extends BaseWorker<EnrichLeadsPayload, EnrichLeadsResult> {
  name = 'enrich-leads';
  concurrency = 5; // process up to 5 concurrent jobs

  async process(job: Job<EnrichLeadsPayload>): Promise<EnrichLeadsResult> {
    const { tenant_id: tenantId, lead_ids } = job.data;

    // 1. Fetch credentials for the Evolution API (optional - enrichment continues without it)
    const decryptedSecrets = await getDecryptedSecrets(tenantId);

    const baseUrl = decryptedSecrets?.evolutionBaseUrl || process.env.EVOLUTION_BASE_URL || 'https://evo.prospix.com.br';
    const instanceName = decryptedSecrets?.evolutionInstanceName || `tenant_${tenantId.slice(0, 8)}`;
    const apiKey = decryptedSecrets?.evolutionApiKey || process.env.EVOLUTION_GUILDS_API_KEY;

    const evolutionAvailable = Boolean(apiKey && !apiKey.startsWith('mock'));
    if (!evolutionAvailable) {
      logger.warn({ tenantId }, 'Evolution API not configured. WhatsApp validation will be skipped, but fit score will still be calculated.');
    }


    // 2. Fetch the tenant
    const { data: tenant, error: tenantErr } = await dbAdmin
      .from('tenants')
      .select('*')
      .eq('id', tenantId)
      .single();

    if (tenantErr || !tenant) {
      logger.error({ tenantId }, 'Tenant not found');
      throw new Error(`Tenant with ID ${tenantId} not found`);
    }

    // 3. Load leads to process
    let leads: any[] = [];
    if (lead_ids && lead_ids.length > 0) {
      const { data } = await dbAdmin
        .from('leads')
        .select('*')
        .in('id', lead_ids)
        .eq('tenant_id', tenantId)
        .eq('status', LeadStatus.CAPTURED);
      leads = data || [];
    } else {
      // Fallback: load up to 100 CAPTURED leads for this tenant
      const { data } = await dbAdmin
        .from('leads')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('status', LeadStatus.CAPTURED)
        .limit(100);
      leads = data || [];
    }

    if (leads.length === 0) {
      logger.info({ tenantId }, 'No CAPTURED leads to enrich');
      return { processed: 0, enriched: 0, archived: 0, failed: 0 };
    }

    let processedCount = 0;
    let enrichedCount = 0;
    let archivedCount = 0;
    let failedCount = 0;

    // 4. Process each lead
    for (const lead of leads) {
      try {
        let whatsappValid: boolean | null = null; // null = not checked
        
        // Step A: Validate WhatsApp via Evolution API checkPhone (optional)
        if (evolutionAvailable) {
          try {
            const checkResult = await checkPhone({
              phone: lead.whatsapp,
              baseUrl,
              instanceName,
              apiKey: apiKey!,
            });

            if (!checkResult.ok) {
              if (checkResult.error.code === 'EXTERNAL_SERVICE_DOWN') {
                logger.warn({ lead_id: lead.id }, 'Evolution API temporarily down. Skipping WhatsApp check for this lead.');
                whatsappValid = null;
              } else {
                logger.error({ lead_id: lead.id, error: checkResult.error }, 'Evolution API check failed for lead');
                whatsappValid = false;
              }
            } else {
              whatsappValid = checkResult.value.exists;
            }
          } catch (evoErr: any) {
            logger.warn({ lead_id: lead.id, err: evoErr.message }, 'Evolution API call failed. Continuing without WhatsApp validation.');
            whatsappValid = null;
          }
        }

        // Step B: Fetch CNPJ Info if lead is an ENTREPRENEUR and CNPJ is in metadata
        const metadata = (lead.metadata as Record<string, any>) || {};
        let yearsOfPractice = lead.years_of_practice || 0;
        let cnpjDetails: any = null;

        if (lead.profession === 'ENTREPRENEUR' && metadata.cnpj) {
          const cnpjResult = await getCnpjInfo(metadata.cnpj);
          if (!cnpjResult.ok) {
            // Throw if temporary down to retry
            if (cnpjResult.error.code === 'EXTERNAL_SERVICE_DOWN') {
              logger.warn({ lead_id: lead.id, cnpj: metadata.cnpj }, 'CNPJ service temporarily down. Retrying.');
              throw new Error(`CNPJ service is down: ${cnpjResult.error.message}`);
            }
            logger.error({ lead_id: lead.id, error: cnpjResult.error }, 'CNPJ enrichment failed');
          } else {
            cnpjDetails = cnpjResult.value;
            // Calculate CNPJ age in years
            if (cnpjDetails.dataInicioAtividade) {
              const age = dayjs().diff(dayjs(cnpjDetails.dataInicioAtividade), 'year');
              yearsOfPractice = age;
              metadata.cnpj_age_years = age;
            }
            metadata.cnpj_info = cnpjDetails;
            // If lead name is empty, use trade/corporate name
            if (!lead.name) {
              lead.name = cnpjDetails.nomeFantasia || cnpjDetails.razaoSocial;
            }
            // Infer owner/partner
            lead.partner_or_owner = true;
          }
        }

        // Step C: Load associated campaign to check minimum fit score threshold
        let minFitScore = 6.0;
        let campaign: any = null;

        if (lead.campaign_id) {
          const { data: campData } = await dbAdmin
            .from('campaigns')
            .select('*')
            .eq('id', lead.campaign_id)
            .single();
          campaign = campData;
          if (campaign?.filters) {
            const filters = campaign.filters as Record<string, any>;
            if (typeof filters.min_fit_score === 'number') {
              minFitScore = filters.min_fit_score;
            }
          }
        }

        // Step D: Calculate Fit Score
        const fitScoreInput = {
          profession: lead.profession,
          whatsapp: lead.whatsapp,
          whatsappValid,
          partnerOrOwner: lead.partner_or_owner,
          yearsOfPractice,
          googleRating: lead.google_rating ? Number(lead.google_rating) : null,
          googleReviewsCount: lead.google_reviews_count,
          address: lead.address,
          metadata,
        };

        const score = calculateFitScore(fitScoreInput, campaign || { profession: lead.profession || '' }, tenant as any);

        // Step E: Determine final status based on fit score vs minimum threshold
        const finalStatus = score >= minFitScore ? LeadStatus.ENRICHED : LeadStatus.ARCHIVED;

        // Step F: Database update (sequential, no transaction wrapper)
        const { error: updateErr } = await dbAdmin
          .from('leads')
          .update({
            name: lead.name,
            whatsapp_valid: whatsappValid,
            years_of_practice: yearsOfPractice,
            partner_or_owner: lead.partner_or_owner,
            fit_score: score === -Infinity ? 0.0 : score, // cap -Infinity to 0 for DB display
            status: finalStatus,
            metadata,
          })
          .eq('id', lead.id);
        if (updateErr) throw updateErr;

        const { error: eventErr } = await dbAdmin
          .from('lead_events')
          .insert({
            tenant_id: tenantId,
            lead_id: lead.id,
            event_type: finalStatus === LeadStatus.ENRICHED ? 'enriched' : 'archived',
            payload: {
              fitScore: score,
              threshold: minFitScore,
              whatsappValid,
              cnpjEnriched: !!cnpjDetails,
            },
          } as any);
        if (eventErr) throw eventErr;

        if (finalStatus === LeadStatus.ENRICHED) {
          enrichedCount++;
        } else {
          archivedCount++;
        }
        processedCount++;
      } catch (err: any) {
        // If it's a temporary API error, let it bubble up to BullMQ to handle retry/DLQ
        if (err.message?.includes('down') || err.message?.includes('failed to communicate')) {
          throw err;
        }
        logger.error({ err, lead_id: lead.id }, 'Enrichment failed for single lead. Skipping.');
        failedCount++;
      }
    }

    return {
      processed: processedCount,
      enriched: enrichedCount,
      archived: archivedCount,
      failed: failedCount,
    };
  }
}
