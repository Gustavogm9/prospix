import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { LeadStatus, Profession, LeadSource } from '@prisma/client';

const VALID_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  CAPTURED: [LeadStatus.ENRICHED, LeadStatus.ARCHIVED],
  ENRICHED: [LeadStatus.CONTACTED, LeadStatus.ARCHIVED],
  CONTACTED: [LeadStatus.CONVERSING, LeadStatus.NO_RESPONSE, LeadStatus.OPTED_OUT],
  NO_RESPONSE: [LeadStatus.CONTACTED, LeadStatus.ARCHIVED],
  CONVERSING: [LeadStatus.QUALIFIED, LeadStatus.NOT_INTERESTED, LeadStatus.OPTED_OUT, LeadStatus.ESCALATED_HUMAN],
  QUALIFIED: [LeadStatus.MEETING_SCHEDULED, LeadStatus.LOST_BEFORE_MEETING],
  MEETING_SCHEDULED: [LeadStatus.CLOSED_WON, LeadStatus.CLOSED_LOST],
  // Terminal or special statuses
  CLOSED_WON: [],
  CLOSED_LOST: [],
  OPTED_OUT: [],
  ARCHIVED: [],
  NOT_INTERESTED: [],
  LOST_BEFORE_MEETING: [],
  ESCALATED_HUMAN: [],
};

export const leadRoutes: FastifyPluginAsync = async (app) => {
  // ── 1. GET /leads (List with cursor-based pagination and advanced filters) ─────
  const listLeadsSchema = z.object({
    limit: z.coerce.number().min(1).max(100).default(50),
    cursor: z.string().uuid().optional(),
    status: z.nativeEnum(LeadStatus).optional(),
    profession: z.nativeEnum(Profession).optional(),
    campaign_id: z.string().uuid().optional(),
    fit_score_gte: z.coerce.number().optional(),
    search: z.string().optional(),
  });

  app.get('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const parseResult = listLeadsSchema.safeParse(req.query);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        message: parseResult.error.errors[0]?.message,
      });
    }

    const { limit, cursor, status, profession, campaign_id, fit_score_gte, search } = parseResult.data;
    const tenantId = req.tenantId!;

    // Build Prisma query filters
    const whereClause: any = {
      tenantId,
      deletedAt: null,
    };

    if (status) whereClause.status = status;
    if (profession) whereClause.profession = profession;
    if (campaign_id) whereClause.campaignId = campaign_id;
    if (fit_score_gte !== undefined) {
      whereClause.fitScore = { gte: fit_score_gte };
    }

    if (search) {
      whereClause.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { whatsapp: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    try {
      const leads = await prisma.lead.findMany({
        take: limit + 1, // Fetch one extra to determine next cursor
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
        where: whereClause,
        orderBy: { id: 'asc' }, // stable paging
      });

      let nextCursor: string | null = null;
      if (leads.length > limit) {
        const nextItem = leads.pop();
        nextCursor = nextItem!.id;
      }

      return reply.code(200).send({
        data: leads,
        nextCursor,
      });
    } catch (err) {
      req.log.error({ err }, 'Failed to list leads');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch leads.',
      });
    }
  });

  // ── 2. GET /leads/:id (Get single lead) ─────────────────────────────────────
  app.get('/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const tenantId = req.tenantId!;

    try {
      const lead = await prisma.lead.findFirst({
        where: {
          id,
          tenantId,
          deletedAt: null,
        },
      });

      if (!lead) {
        return reply.code(404).send({
          error: 'RESOURCE_NOT_FOUND',
          message: 'Lead not found',
        });
      }

      return reply.code(200).send(lead);
    } catch (err) {
      req.log.error({ err, id }, 'Failed to get lead');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch lead.',
      });
    }
  });

  // ── 3. POST /leads (Create manual lead) ─────────────────────────────────────
  const createLeadSchema = z.object({
    name: z.string().min(1, 'Name is required').optional(),
    profession: z.nativeEnum(Profession).optional(),
    whatsapp: z.string().min(8, 'WhatsApp number too short'),
    email: z.string().email().optional(),
    address: z.object({
      city: z.string().optional(),
      neighborhood: z.string().optional(),
      street: z.string().optional(),
    }).optional(),
    campaignId: z.string().uuid().optional(),
    metadata: z.record(z.any()).optional(),
  });

  app.post('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const parseResult = createLeadSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        message: parseResult.error.errors[0]?.message,
      });
    }

    const data = parseResult.data;
    const tenantId = req.tenantId!;

    // Clean up WhatsApp phone number
    const sanitizedWhatsapp = data.whatsapp.replace(/[^0-9]/g, '');
    const finalWhatsapp = sanitizedWhatsapp.startsWith('55') ? sanitizedWhatsapp : `55${sanitizedWhatsapp}`;

    try {
      // Uniqueness check: (tenant_id, whatsapp)
      const existing = await prisma.lead.findUnique({
        where: {
          tenantId_whatsapp: {
            tenantId,
            whatsapp: finalWhatsapp,
          },
        },
      });

      if (existing) {
        return reply.code(409).send({
          error: 'Conflict',
          message: 'A lead with this WhatsApp number already exists for this tenant.',
        });
      }

      const lead = await prisma.$transaction(async (tx) => {
        const newLead = await tx.lead.create({
          data: {
            tenantId,
            campaignId: data.campaignId,
            source: LeadSource.MANUAL,
            name: data.name,
            profession: data.profession,
            whatsapp: finalWhatsapp,
            email: data.email,
            address: data.address as any,
            status: LeadStatus.CAPTURED,
            metadata: data.metadata,
          },
        });

        await tx.leadEvent.create({
          data: {
            tenantId,
            leadId: newLead.id,
            eventType: 'captured',
            actorId: req.userId || undefined,
            payload: {
              source: 'manual',
            },
          },
        });

        return newLead;
      });

      return reply.code(201).send(lead);
    } catch (err) {
      req.log.error({ err }, 'Failed to create lead');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to create lead.',
      });
    }
  });

  // ── 4. PATCH /leads/:id (Update lead fields & state transition) ─────────────
  const updateLeadSchema = z.object({
    name: z.string().optional(),
    profession: z.nativeEnum(Profession).optional(),
    email: z.string().email().optional(),
    status: z.nativeEnum(LeadStatus).optional(),
    partnerOrOwner: z.boolean().optional(),
    yearsOfPractice: z.number().optional(),
    address: z.any().optional(),
    metadata: z.record(z.any()).optional(),
  });

  app.patch('/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const tenantId = req.tenantId!;

    const parseResult = updateLeadSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        message: parseResult.error.errors[0]?.message,
      });
    }

    const data = parseResult.data;

    try {
      const lead = await prisma.lead.findFirst({
        where: {
          id,
          tenantId,
          deletedAt: null,
        },
      });

      if (!lead) {
        return reply.code(404).send({
          error: 'RESOURCE_NOT_FOUND',
          message: 'Lead not found',
        });
      }

      // If status is transitioning, validate through the state machine
      if (data.status && data.status !== lead.status) {
        const allowedTransitions = VALID_TRANSITIONS[lead.status] || [];
        if (!allowedTransitions.includes(data.status)) {
          return reply.code(400).send({
            error: 'InvalidTransition',
            message: `Transitioning lead status from ${lead.status} to ${data.status} is not allowed.`,
          });
        }
      }

      const updatedLead = await prisma.$transaction(async (tx) => {
        const res = await tx.lead.update({
          where: { id },
          data: {
            name: data.name,
            profession: data.profession,
            email: data.email,
            status: data.status,
            partnerOrOwner: data.partnerOrOwner,
            yearsOfPractice: data.yearsOfPractice,
            address: data.address,
            metadata: data.metadata ? { ...(lead.metadata as any || {}), ...data.metadata } : undefined,
          },
        });

        // Record status change event
        if (data.status && data.status !== lead.status) {
          await tx.leadEvent.create({
            data: {
              tenantId,
              leadId: id,
              eventType: 'status_changed',
              actorId: req.userId || undefined,
              payload: {
                from: lead.status,
                to: data.status,
              },
            },
          });
        }

        return res;
      });

      return reply.code(200).send(updatedLead);
    } catch (err) {
      req.log.error({ err, id }, 'Failed to update lead');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update lead.',
      });
    }
  });

  // ── 5. DELETE /leads/:id (Soft Delete) ──────────────────────────────────────
  app.delete('/:id', {
    preHandler: [async (req, reply) => {
      if ((req as any).userRole && (req as any).userRole !== 'OWNER') {
        return reply.code(403).send({ error: 'Forbidden', message: 'Only owners can perform this action' });
      }
    }],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const tenantId = req.tenantId!;

    try {
      const lead = await prisma.lead.findFirst({
        where: {
          id,
          tenantId,
          deletedAt: null,
        },
      });

      if (!lead) {
        return reply.code(404).send({
          error: 'RESOURCE_NOT_FOUND',
          message: 'Lead not found',
        });
      }

      await prisma.$transaction(async (tx) => {
        await tx.lead.update({
          where: { id },
          data: {
            deletedAt: new Date(),
            status: LeadStatus.ARCHIVED, // optionally transition terminal status
          },
        });

        await tx.leadEvent.create({
          data: {
            tenantId,
            leadId: id,
            eventType: 'deleted',
            actorId: req.userId || undefined,
            payload: {
              reason: 'manual_soft_delete',
            },
          },
        });
      });

      return reply.code(204).send();
    } catch (err) {
      req.log.error({ err, id }, 'Failed to soft delete lead');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to delete lead.',
      });
    }
  });

  // ── 6. POST /leads/:id/optout (Opt-out lead) ────────────────────────────────
  app.post('/:id/optout', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const tenantId = req.tenantId!;
    const { reason } = (req.body || {}) as { reason?: string };

    try {
      const lead = await prisma.lead.findFirst({
        where: {
          id,
          tenantId,
          deletedAt: null,
        },
      });

      if (!lead) {
        return reply.code(404).send({
          error: 'RESOURCE_NOT_FOUND',
          message: 'Lead not found',
        });
      }

      await prisma.$transaction(async (tx) => {
        // 1. Create or upsert Optout record
        await tx.optout.upsert({
          where: {
            tenantId_whatsapp: {
              tenantId,
              whatsapp: lead.whatsapp,
            },
          },
          create: {
            tenantId,
            whatsapp: lead.whatsapp,
            reason: reason || 'Lead request',
            source: 'manual',
          },
          update: {
            reason: reason || 'Lead request updated',
          },
        });

        // 2. Update lead status to OPTED_OUT
        await tx.lead.update({
          where: { id },
          data: {
            status: LeadStatus.OPTED_OUT,
          },
        });

        // 3. Log event
        await tx.leadEvent.create({
          data: {
            tenantId,
            leadId: id,
            eventType: 'optout',
            actorId: req.userId || undefined,
            payload: {
              reason: reason || 'manual_optout',
            },
          },
        });
      });

      return reply.code(200).send({ success: true, message: 'Lead opted out successfully' });
    } catch (err) {
      req.log.error({ err, id }, 'Failed to optout lead');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to record opt-out.',
      });
    }
  });

  // ── 7. POST /leads/:id/notes (Add notes) ────────────────────────────────────
  const noteSchema = z.object({
    content: z.string().min(1, 'Content is required'),
  });

  app.post('/:id/notes', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const tenantId = req.tenantId!;

    const parseResult = noteSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        message: parseResult.error.errors[0]?.message,
      });
    }

    try {
      const lead = await prisma.lead.findFirst({
        where: {
          id,
          tenantId,
          deletedAt: null,
        },
      });

      if (!lead) {
        return reply.code(404).send({
          error: 'RESOURCE_NOT_FOUND',
          message: 'Lead not found',
        });
      }

      const note = await prisma.leadNote.create({
        data: {
          tenantId,
          leadId: id,
          authorId: req.userId,
          content: parseResult.data.content,
        },
      });

      return reply.code(201).send(note);
    } catch (err) {
      req.log.error({ err, id }, 'Failed to create lead note');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to create lead note.',
      });
    }
  });

  // ── 8. GET /leads/:id/notes (List notes) ────────────────────────────────────
  app.get('/:id/notes', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const tenantId = req.tenantId!;

    try {
      const lead = await prisma.lead.findFirst({
        where: {
          id,
          tenantId,
          deletedAt: null,
        },
      });

      if (!lead) {
        return reply.code(404).send({
          error: 'RESOURCE_NOT_FOUND',
          message: 'Lead not found',
        });
      }

      const notes = await prisma.leadNote.findMany({
        where: {
          tenantId,
          leadId: id,
        },
        orderBy: { createdAt: 'desc' },
      });

      return reply.code(200).send(notes);
    } catch (err) {
      req.log.error({ err, id }, 'Failed to list lead notes');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to list notes.',
      });
    }
  });
};
