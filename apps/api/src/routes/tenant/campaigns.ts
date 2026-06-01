import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDb } from '../../lib/db.js';
import { CampaignStatus, Profession } from '@prospix/shared-types';
import { syncCampaignCaptureSchedule } from '../../lib/queue.js';

export const campaignRoutes: FastifyPluginAsync = async (app) => {
  // 🔹 1. GET /campaigns (List non-archived campaigns) 🔹
  app.get('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.tenantId!;
    const db = getDb(req);

    try {
      const { data: campaigns, error } = await db
        .from('campaigns')
        .select('*')
        .eq('tenant_id', tenantId)
        .neq('status', CampaignStatus.ARCHIVED)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return reply.code(200).send(campaigns);
    } catch (err) {
      req.log.error({ err }, 'Failed to list campaigns');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch campaigns.',
      });
    }
  });

  // 🔹 2. GET /campaigns/:id (Get single campaign) 🔹
  app.get('/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const tenantId = req.tenantId!;
    const db = getDb(req);

    try {
      const { data: campaign, error } = await db
        .from('campaigns')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (error) throw error;

      if (!campaign) {
        return reply.code(404).send({
          error: 'RESOURCE_NOT_FOUND',
          message: 'Campaign not found',
        });
      }

      return reply.code(200).send(campaign);
    } catch (err) {
      req.log.error({ err, id }, 'Failed to get campaign');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch campaign.',
      });
    }
  });

  // 🔹 3. POST /campaigns (Create campaign) 🔹
  const createCampaignSchema = z.object({
    name: z.string().min(1, 'Campaign name is required'),
    profession: z.nativeEnum(Profession),
    cities: z.array(z.string()).min(1, 'At least one city is required'),
    neighborhoods: z.array(z.string()).optional().default([]),
    dailyLimit: z.number().int().positive('Daily limit must be a positive integer').default(100),
    hourWindowStart: z.number().int().min(0).max(23).default(9),
    hourWindowEnd: z.number().int().min(0).max(23).default(18),
    activeScriptId: z.string().uuid().optional(),
    filters: z.record(z.any()).optional().default({ min_fit_score: 6.0 }),
  });

  app.post('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const parseResult = createCampaignSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        message: parseResult.error.errors[0]?.message,
      });
    }

    const data = parseResult.data;
    const tenantId = req.tenantId!;
    const db = getDb(req);

    try {
      const { data: campaign, error } = await db
        .from('campaigns')
        .insert({
          id: crypto.randomUUID(),
          tenant_id: tenantId,
          name: data.name,
          profession: data.profession,
          cities: data.cities,
          neighborhoods: data.neighborhoods,
          daily_limit: data.dailyLimit,
          hour_window_start: data.hourWindowStart,
          hour_window_end: data.hourWindowEnd,
          active_script_id: data.activeScriptId,
          filters: data.filters,
          status: CampaignStatus.DRAFT,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      return reply.code(201).send(campaign);
    } catch (err) {
      req.log.error({ err }, 'Failed to create campaign');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to create campaign.',
      });
    }
  });

  // 🔹 4. PATCH /campaigns/:id (Update campaign) 🔹
  const updateCampaignSchema = z.object({
    name: z.string().optional(),
    profession: z.nativeEnum(Profession).optional(),
    cities: z.array(z.string()).min(1, 'At least one city is required').optional(),
    neighborhoods: z.array(z.string()).optional(),
    dailyLimit: z.number().int().positive().optional(),
    hourWindowStart: z.number().int().min(0).max(23).optional(),
    hourWindowEnd: z.number().int().min(0).max(23).optional(),
    activeScriptId: z.string().uuid().optional(),
    filters: z.record(z.any()).optional(),
  });

  app.patch('/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const tenantId = req.tenantId!;
    const db = getDb(req);

    const parseResult = updateCampaignSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        message: parseResult.error.errors[0]?.message,
      });
    }

    const data = parseResult.data;

    try {
      const { data: campaign, error: findErr } = await db
        .from('campaigns')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (findErr) throw findErr;

      if (!campaign) {
        return reply.code(404).send({
          error: 'RESOURCE_NOT_FOUND',
          message: 'Campaign not found',
        });
      }

      if (campaign.status === CampaignStatus.ARCHIVED) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: 'Cannot update an archived campaign',
        });
      }

      const { data: updatedCampaign, error: updateErr } = await db
        .from('campaigns')
        .update({
          name: data.name,
          profession: data.profession,
          cities: data.cities,
          neighborhoods: data.neighborhoods,
          daily_limit: data.dailyLimit,
          hour_window_start: data.hourWindowStart,
          hour_window_end: data.hourWindowEnd,
          active_script_id: data.activeScriptId,
          filters: data.filters ? { ...(campaign.filters as any || {}), ...data.filters } : undefined,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (updateErr) throw updateErr;

      return reply.code(200).send(updatedCampaign);
    } catch (err) {
      req.log.error({ err, id }, 'Failed to update campaign');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update campaign.',
      });
    }
  });

  // 🔹 5. POST /campaigns/:id/pause (Pause active campaign) 🔹
  app.post('/:id/pause', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const tenantId = req.tenantId!;
    const db = getDb(req);

    try {
      const { data: campaign, error: findErr } = await db
        .from('campaigns')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (findErr) throw findErr;

      if (!campaign) {
        return reply.code(404).send({
          error: 'RESOURCE_NOT_FOUND',
          message: 'Campaign not found',
        });
      }

      if (campaign.status !== CampaignStatus.ACTIVE) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: `Campaign cannot be paused because its current status is ${campaign.status}`,
        });
      }

      const { data: pausedCampaign, error: updateErr } = await db
        .from('campaigns')
        .update({
          status: CampaignStatus.PAUSED,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (updateErr) throw updateErr;

      // Remove capture cron for paused campaign
      syncCampaignCaptureSchedule(tenantId, pausedCampaign.id, 'PAUSED', pausedCampaign.cities ?? []).catch(
        (err) => req.log.error({ err, campaignId: id }, 'Failed to remove capture cron')
      );

      return reply.code(200).send(pausedCampaign);
    } catch (err) {
      req.log.error({ err, id }, 'Failed to pause campaign');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to pause campaign.',
      });
    }
  });

  // 🔹 6. POST /campaigns/:id/resume (Resume paused or draft campaign to active)
  app.post('/:id/resume', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const tenantId = req.tenantId!;
    const db = getDb(req);

    try {
      const { data: campaign, error: findErr } = await db
        .from('campaigns')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (findErr) throw findErr;

      if (!campaign) {
        return reply.code(404).send({
          error: 'RESOURCE_NOT_FOUND',
          message: 'Campaign not found',
        });
      }

      if (campaign.status !== CampaignStatus.PAUSED && campaign.status !== CampaignStatus.DRAFT) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: `Campaign cannot be activated because its current status is ${campaign.status}`,
        });
      }

      const { data: activeCampaign, error: updateErr } = await db
        .from('campaigns')
        .update({
          status: CampaignStatus.ACTIVE,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (updateErr) throw updateErr;

      // Schedule capture cron for active campaign
      syncCampaignCaptureSchedule(tenantId, activeCampaign.id, 'ACTIVE', activeCampaign.cities ?? []).catch(
        (err) => req.log.error({ err, campaignId: id }, 'Failed to schedule capture cron')
      );

      return reply.code(200).send(activeCampaign);
    } catch (err) {
      req.log.error({ err, id }, 'Failed to resume campaign');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to resume campaign.',
      });
    }
  });

  // 🔹 7. DELETE /campaigns/:id (Soft delete campaign) 🔹
  app.delete('/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const tenantId = req.tenantId!;
    const db = getDb(req);

    try {
      const { data: campaign, error: findErr } = await db
        .from('campaigns')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (findErr) throw findErr;

      if (!campaign) {
        return reply.code(404).send({
          error: 'RESOURCE_NOT_FOUND',
          message: 'Campaign not found',
        });
      }

      const { error: updateErr } = await db
        .from('campaigns')
        .update({
          status: CampaignStatus.ARCHIVED,
          archived_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (updateErr) throw updateErr;

      // Remove capture cron for archived campaign
      syncCampaignCaptureSchedule(tenantId, id, 'ARCHIVED', []).catch(
        (err) => req.log.error({ err, campaignId: id }, 'Failed to remove capture cron')
      );

      return reply.code(204).send();
    } catch (err) {
      req.log.error({ err, id }, 'Failed to soft delete campaign');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to delete campaign.',
      });
    }
  });
};
