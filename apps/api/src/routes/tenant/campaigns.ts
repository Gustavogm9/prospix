import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { CampaignStatus, Profession } from '@prisma/client';

export const campaignRoutes: FastifyPluginAsync = async (app) => {
  // ── 1. GET /campaigns (List non-archived campaigns) ─────────────────────────
  app.get('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const tenantId = req.tenantId!;

    try {
      const campaigns = await prisma.campaign.findMany({
        where: {
          tenantId,
          status: {
            not: CampaignStatus.ARCHIVED,
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return reply.code(200).send(campaigns);
    } catch (err) {
      req.log.error({ err }, 'Failed to list campaigns');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch campaigns.',
      });
    }
  });

  // ── 2. GET /campaigns/:id (Get single campaign) ─────────────────────────────
  app.get('/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const tenantId = req.tenantId!;

    try {
      const campaign = await prisma.campaign.findFirst({
        where: {
          id,
          tenantId,
        },
      });

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

  // ── 3. POST /campaigns (Create campaign) ────────────────────────────────────
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

    try {
      const campaign = await prisma.campaign.create({
        data: {
          tenantId,
          name: data.name,
          profession: data.profession,
          cities: data.cities,
          neighborhoods: data.neighborhoods,
          dailyLimit: data.dailyLimit,
          hourWindowStart: data.hourWindowStart,
          hourWindowEnd: data.hourWindowEnd,
          activeScriptId: data.activeScriptId,
          filters: data.filters,
          status: CampaignStatus.DRAFT,
        },
      });

      return reply.code(201).send(campaign);
    } catch (err) {
      req.log.error({ err }, 'Failed to create campaign');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to create campaign.',
      });
    }
  });

  // ── 4. PATCH /campaigns/:id (Update campaign) ───────────────────────────────
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

    const parseResult = updateCampaignSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        message: parseResult.error.errors[0]?.message,
      });
    }

    const data = parseResult.data;

    try {
      const campaign = await prisma.campaign.findFirst({
        where: {
          id,
          tenantId,
        },
      });

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

      const updatedCampaign = await prisma.campaign.update({
        where: { id },
        data: {
          name: data.name,
          profession: data.profession,
          cities: data.cities,
          neighborhoods: data.neighborhoods,
          dailyLimit: data.dailyLimit,
          hourWindowStart: data.hourWindowStart,
          hourWindowEnd: data.hourWindowEnd,
          activeScriptId: data.activeScriptId,
          filters: data.filters ? { ...(campaign.filters as any || {}), ...data.filters } : undefined,
        },
      });

      return reply.code(200).send(updatedCampaign);
    } catch (err) {
      req.log.error({ err, id }, 'Failed to update campaign');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update campaign.',
      });
    }
  });

  // ── 5. POST /campaigns/:id/pause (Pause active campaign) ────────────────────
  app.post('/:id/pause', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const tenantId = req.tenantId!;

    try {
      const campaign = await prisma.campaign.findFirst({
        where: {
          id,
          tenantId,
        },
      });

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

      const pausedCampaign = await prisma.campaign.update({
        where: { id },
        data: {
          status: CampaignStatus.PAUSED,
        },
      });

      return reply.code(200).send(pausedCampaign);
    } catch (err) {
      req.log.error({ err, id }, 'Failed to pause campaign');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to pause campaign.',
      });
    }
  });

  // ── 6. POST /campaigns/:id/resume (Resume paused or draft campaign to active)
  app.post('/:id/resume', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const tenantId = req.tenantId!;

    try {
      const campaign = await prisma.campaign.findFirst({
        where: {
          id,
          tenantId,
        },
      });

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

      const activeCampaign = await prisma.campaign.update({
        where: { id },
        data: {
          status: CampaignStatus.ACTIVE,
        },
      });

      return reply.code(200).send(activeCampaign);
    } catch (err) {
      req.log.error({ err, id }, 'Failed to resume campaign');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to resume campaign.',
      });
    }
  });

  // ── 7. DELETE /campaigns/:id (Soft delete campaign) ──────────────────────────
  app.delete('/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const tenantId = req.tenantId!;

    try {
      const campaign = await prisma.campaign.findFirst({
        where: {
          id,
          tenantId,
        },
      });

      if (!campaign) {
        return reply.code(404).send({
          error: 'RESOURCE_NOT_FOUND',
          message: 'Campaign not found',
        });
      }

      await prisma.campaign.update({
        where: { id },
        data: {
          status: CampaignStatus.ARCHIVED,
          archivedAt: new Date(),
        },
      });

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
