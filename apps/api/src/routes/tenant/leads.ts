import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDb, dbAdmin } from '../../lib/db.js';
import { LeadStatus, Profession, LeadSource } from '@prospix/shared-types';

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
  // 🔹 1. GET /leads (List with cursor-based pagination and advanced filters) 🔹
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
    const db = getDb(req);

    try {
      let query = db
        .from('leads')
        .select('*')
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .order('id', { ascending: true })
        .limit(limit + 1);

      if (status) query = query.eq('status', status);
      if (profession) query = query.eq('profession', profession);
      if (campaign_id) query = query.eq('campaign_id', campaign_id);
      if (fit_score_gte !== undefined) query = query.gte('fit_score', fit_score_gte);

      if (search) {
        query = query.or(`name.ilike.%${search}%,whatsapp.ilike.%${search}%,email.ilike.%${search}%`);
      }

      if (cursor) {
        query = query.gt('id', cursor);
      }

      const { data: leads, error } = await query;
      if (error) throw error;

      let nextCursor: string | null = null;
      if (leads && leads.length > limit) {
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

  // 🔹 2. GET /leads/:id (Get single lead) 🔹
  app.get('/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const tenantId = req.tenantId!;
    const db = getDb(req);

    try {
      const { data: lead, error } = await db
        .from('leads')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .maybeSingle();

      if (error) throw error;

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

  // 🔹 3. POST /leads (Create manual lead) 🔹
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
    const db = getDb(req);

    // Clean up WhatsApp phone number
    const sanitizedWhatsapp = data.whatsapp.replace(/[^0-9]/g, '');
    const finalWhatsapp = sanitizedWhatsapp.startsWith('55') ? sanitizedWhatsapp : `55${sanitizedWhatsapp}`;

    try {
      // Uniqueness check: (tenant_id, whatsapp)
      const { data: existing, error: findErr } = await db
        .from('leads')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('whatsapp', finalWhatsapp)
        .maybeSingle();

      if (findErr) throw findErr;

      if (existing) {
        return reply.code(409).send({
          error: 'Conflict',
          message: 'A lead with this WhatsApp number already exists for this tenant.',
        });
      }

      // Create lead (sequential instead of $transaction)
      const now = new Date().toISOString();
      const leadId = crypto.randomUUID();
      const { data: newLead, error: createErr } = await db
        .from('leads')
        .insert({
          id: leadId,
          tenant_id: tenantId,
          campaign_id: data.campaignId,
          source: LeadSource.MANUAL,
          name: data.name,
          profession: data.profession,
          whatsapp: finalWhatsapp,
          email: data.email,
          address: data.address as any,
          status: LeadStatus.CAPTURED,
          metadata: data.metadata,
          updated_at: now,
        })
        .select()
        .single();

      if (createErr) throw createErr;

      // Record captured event
      await db
        .from('lead_events')
        .insert({
          tenant_id: tenantId,
          lead_id: leadId,
          event_type: 'captured',
          actor_id: req.userId || undefined,
          payload: {
            source: 'manual',
          },
        });

      return reply.code(201).send(newLead);
    } catch (err) {
      req.log.error({ err }, 'Failed to create lead');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to create lead.',
      });
    }
  });

  // 🔹 4. PATCH /leads/:id (Update lead fields & state transition) 🔹
  const updateLeadSchema = z.object({
    name: z.string().optional(),
    profession: z.nativeEnum(Profession).optional(),
    email: z.string().email().optional(),
    status: z.nativeEnum(LeadStatus).optional(),
    partnerOrOwner: z.boolean().optional(),
    yearsOfPractice: z.number().optional(),
    address: z.record(z.any()).optional(),
    metadata: z.record(z.any()).optional(),
  });

  app.patch('/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const tenantId = req.tenantId!;
    const db = getDb(req);

    const parseResult = updateLeadSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        message: parseResult.error.errors[0]?.message,
      });
    }

    const data = parseResult.data;

    try {
      const { data: lead, error: findErr } = await db
        .from('leads')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .maybeSingle();

      if (findErr) throw findErr;

      if (!lead) {
        return reply.code(404).send({
          error: 'RESOURCE_NOT_FOUND',
          message: 'Lead not found',
        });
      }

      // If status is transitioning, validate through the state machine
      if (data.status && data.status !== lead.status) {
        const allowedTransitions = VALID_TRANSITIONS[lead.status as LeadStatus] || [];
        if (!allowedTransitions.includes(data.status)) {
          return reply.code(400).send({
            error: 'InvalidTransition',
            message: `Transitioning lead status from ${lead.status} to ${data.status} is not allowed.`,
          });
        }
      }

      // Sequential instead of $transaction
      const { data: updatedLead, error: updateErr } = await db
        .from('leads')
        .update({
          name: data.name,
          profession: data.profession,
          email: data.email,
          status: data.status,
          partner_or_owner: data.partnerOrOwner,
          years_of_practice: data.yearsOfPractice,
          address: data.address,
          metadata: data.metadata ? { ...(lead.metadata as any || {}), ...data.metadata } : undefined,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (updateErr) throw updateErr;

      // Record status change event
      if (data.status && data.status !== lead.status) {
        await db
          .from('lead_events')
          .insert({
            tenant_id: tenantId,
            lead_id: id,
            event_type: 'status_changed',
            actor_id: req.userId || undefined,
            payload: {
              from: lead.status,
              to: data.status,
            },
          });
      }

      return reply.code(200).send(updatedLead);
    } catch (err) {
      req.log.error({ err, id }, 'Failed to update lead');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update lead.',
      });
    }
  });

  // 🔹 5. DELETE /leads/:id (Soft Delete) 🔹
  app.delete('/:id', {
    preHandler: [async (req, reply) => {
      if ((req as any).userRole && (req as any).userRole !== 'OWNER') {
        return reply.code(403).send({ error: 'Forbidden', message: 'Only owners can perform this action' });
      }
    }],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const tenantId = req.tenantId!;
    const db = getDb(req);

    try {
      const { data: lead, error: findErr } = await db
        .from('leads')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .maybeSingle();

      if (findErr) throw findErr;

      if (!lead) {
        return reply.code(404).send({
          error: 'RESOURCE_NOT_FOUND',
          message: 'Lead not found',
        });
      }

      // Sequential instead of $transaction
      const { error: updateErr } = await db
        .from('leads')
        .update({
          deleted_at: new Date().toISOString(),
          status: LeadStatus.ARCHIVED,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (updateErr) throw updateErr;

      await db
        .from('lead_events')
        .insert({
          tenant_id: tenantId,
          lead_id: id,
          event_type: 'deleted',
          actor_id: req.userId || undefined,
          payload: {
            reason: 'manual_soft_delete',
          },
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

  // 🔹 6. POST /leads/:id/optout (Opt-out lead) 🔹
  app.post('/:id/optout', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const tenantId = req.tenantId!;
    const db = getDb(req);
    const { reason } = (req.body || {}) as { reason?: string };

    try {
      const { data: lead, error: findErr } = await db
        .from('leads')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .maybeSingle();

      if (findErr) throw findErr;

      if (!lead) {
        return reply.code(404).send({
          error: 'RESOURCE_NOT_FOUND',
          message: 'Lead not found',
        });
      }

      // Sequential instead of $transaction
      // 1. Create or upsert Optout record
      await dbAdmin
        .from('optouts')
        .upsert({
          tenant_id: tenantId,
          whatsapp: lead.whatsapp,
          reason: reason || 'Lead request',
          source: 'manual',
        }, { onConflict: 'tenant_id,whatsapp' });

      // 2. Update lead status to OPTED_OUT
      await db
        .from('leads')
        .update({
          status: LeadStatus.OPTED_OUT,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      // 3. Log event
      await db
        .from('lead_events')
        .insert({
          tenant_id: tenantId,
          lead_id: id,
          event_type: 'optout',
          actor_id: req.userId || undefined,
          payload: {
            reason: reason || 'manual_optout',
          },
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

  // 🔹 7. POST /leads/:id/notes (Add notes) 🔹
  const noteSchema = z.object({
    content: z.string().min(1, 'Content is required'),
  });

  app.post('/:id/notes', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const tenantId = req.tenantId!;
    const db = getDb(req);

    const parseResult = noteSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        message: parseResult.error.errors[0]?.message,
      });
    }

    try {
      const { data: lead, error: findErr } = await db
        .from('leads')
        .select('id')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .maybeSingle();

      if (findErr) throw findErr;

      if (!lead) {
        return reply.code(404).send({
          error: 'RESOURCE_NOT_FOUND',
          message: 'Lead not found',
        });
      }

      const { data: note, error: createErr } = await db
        .from('lead_notes')
        .insert({
          id: crypto.randomUUID(),
          tenant_id: tenantId,
          lead_id: id,
          author_id: req.userId,
          content: parseResult.data.content,
        })
        .select()
        .single();

      if (createErr) throw createErr;

      return reply.code(201).send(note);
    } catch (err) {
      req.log.error({ err, id }, 'Failed to create lead note');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to create lead note.',
      });
    }
  });

  // 🔹 8. GET /leads/:id/notes (List notes) 🔹
  app.get('/:id/notes', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const tenantId = req.tenantId!;
    const db = getDb(req);

    try {
      const { data: lead, error: findErr } = await db
        .from('leads')
        .select('id')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .maybeSingle();

      if (findErr) throw findErr;

      if (!lead) {
        return reply.code(404).send({
          error: 'RESOURCE_NOT_FOUND',
          message: 'Lead not found',
        });
      }

      const { data: notes, error } = await db
        .from('lead_notes')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('lead_id', id)
        .order('created_at', { ascending: false });

      if (error) throw error;

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
