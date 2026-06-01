/**
 * Centralized Supabase Queries Module
 *
 * Replaces all apiClient calls with direct Supabase queries.
 * All tables have RLS enabled with tenant_id filtering — queries
 * are automatically scoped to the authenticated user's tenant.
 *
 * @module queries
 */

import { supabase } from './supabase';
import type { Database } from '../../../api/src/lib/database.types';

// ─── Row Types (shorthand) ─────────────────────────────────────────────────────

type Tables = Database['public']['Tables'];
type Enums = Database['public']['Enums'];

export type Lead = Tables['leads']['Row'];
export type LeadInsert = Tables['leads']['Insert'];
export type LeadUpdate = Tables['leads']['Update'];
export type Campaign = Tables['campaigns']['Row'];
export type CampaignInsert = Tables['campaigns']['Insert'];
export type CampaignUpdate = Tables['campaigns']['Update'];
export type Conversation = Tables['conversations']['Row'];
export type ConversationInsert = Tables['conversations']['Insert'];
export type Message = Tables['messages']['Row'];
export type MessageInsert = Tables['messages']['Insert'];
export type Meeting = Tables['meetings']['Row'];
export type MeetingInsert = Tables['meetings']['Insert'];
export type MeetingUpdate = Tables['meetings']['Update'];
export type Script = Tables['scripts']['Row'];
export type ScriptInsert = Tables['scripts']['Insert'];
export type ScriptUpdate = Tables['scripts']['Update'];
export type ScriptVariation = Tables['script_variations']['Row'];
export type Notification = Tables['notifications']['Row'];
export type NotificationPreference = Tables['notification_preferences']['Row'];
export type TenantBilling = Tables['tenant_billing']['Row'];
export type TenantUsage = Tables['tenant_usage']['Row'];
export type LgpdRequest = Tables['lgpd_requests']['Row'];
export type LgpdRequestInsert = Tables['lgpd_requests']['Insert'];
export type LeadEvent = Tables['lead_events']['Row'];
export type LeadNote = Tables['lead_notes']['Row'];
export type LeadNoteInsert = Tables['lead_notes']['Insert'];
export type User = Tables['users']['Row'];
export type UserUpdate = Tables['users']['Update'];
export type Tenant = Tables['tenants']['Row'];

export type LeadStatus = Enums['LeadStatus'];
export type CampaignStatus = Enums['CampaignStatus'];
export type ConversationStatus = Enums['ConversationStatus'];
export type MeetingStatus = Enums['MeetingStatus'];
export type MeetingOutcome = Enums['MeetingOutcome'];
export type ScriptStatus = Enums['ScriptStatus'];
export type LgpdRequestType = Enums['LgpdRequestType'];
export type LgpdRequestStatus = Enums['LgpdRequestStatus'];
export type Profession = Enums['Profession'];

// ─── Common Interfaces ─────────────────────────────────────────────────────────

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface CursorPaginationParams {
  limit?: number;
  cursor?: string;
}

export interface CursorPaginatedResult<T> {
  data: T[];
  nextCursor: string | null;
}

export interface PaginatedResult<T> {
  data: T[];
  count: number | null;
}

export interface QueryError {
  message: string;
  code?: string;
  details?: string;
}

export interface QueryResult<T> {
  data: T | null;
  error: QueryError | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────




function mapError(error: unknown): QueryError {
  if (error && typeof error === 'object' && 'message' in error) {
    const e = error as { message: string; code?: string; details?: string };
    return { message: e.message, code: e.code, details: e.details };
  }
  return { message: 'Unknown error' };
}

function startOfMonth(date = new Date()): string {
  const d = new Date(date);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function todayRange(): { start: string; end: string } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEADS
// ═══════════════════════════════════════════════════════════════════════════════

export interface LeadFilters extends CursorPaginationParams {
  status?: LeadStatus;
  profession?: Profession;
  campaign_id?: string;
  fit_score_gte?: number;
  search?: string;
}

export const leadsQueries = {
  /** List leads with cursor-based pagination and advanced filters */
  list: async (tenantId: string, filters: LeadFilters = {}) => {
    const { limit = 50, cursor, status, profession, campaign_id, fit_score_gte, search } = filters;

    let query = supabase
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
    if (cursor) query = query.gt('id', cursor);

    const { data, error } = await query;
    if (error) return { data: [], nextCursor: null, error: mapError(error) };

    let nextCursor: string | null = null;
    const list = data ?? [];
    if (list.length > limit) {
      const last = list.pop();
      nextCursor = last!.id;
    }

    return { data: list, nextCursor, error: null } as CursorPaginatedResult<Lead> & { error: null };
  },

  /** Get a single lead by ID */
  getById: async (tenantId: string, id: string) => {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) return { data: null, error: mapError(error) };
    return { data, error: null };
  },

  /** Create a new manual lead */
  create: async (tenantId: string, leadData: {
    name?: string;
    profession?: Profession;
    whatsapp: string;
    email?: string;
    address?: { city?: string; neighborhood?: string; street?: string };
    campaignId?: string;
    metadata?: Record<string, unknown>;
  }) => {
    const sanitized = leadData.whatsapp.replace(/[^0-9]/g, '');
    const finalWhatsapp = sanitized.startsWith('55') ? sanitized : `55${sanitized}`;

    // Uniqueness check
    const { data: existing } = await supabase
      .from('leads')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('whatsapp', finalWhatsapp)
      .maybeSingle();

    if (existing) {
      return { data: null, error: { message: 'A lead with this WhatsApp number already exists.', code: 'CONFLICT' } };
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('leads')
      .insert({
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        campaign_id: leadData.campaignId,
        source: 'MANUAL' as const,
        name: leadData.name,
        profession: leadData.profession,
        whatsapp: finalWhatsapp,
        email: leadData.email,
        address: leadData.address as any,
        status: 'CAPTURED' as const,
        metadata: leadData.metadata as any,
        updated_at: now,
      })
      .select()
      .single();

    if (error) return { data: null, error: mapError(error) };

    // Record captured event
    await supabase.from('lead_events').insert({
      tenant_id: tenantId,
      lead_id: data.id,
      event_type: 'captured',
      payload: { source: 'manual' } as any,
    });

    return { data, error: null };
  },

  /** Update lead fields and/or status transition */
  update: async (tenantId: string, id: string, updateData: {
    name?: string;
    profession?: Profession;
    email?: string;
    status?: LeadStatus;
    partnerOrOwner?: boolean;
    yearsOfPractice?: number;
    address?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }) => {
    // Get current lead for state machine validation and metadata merge
    const { data: lead, error: findErr } = await supabase
      .from('leads')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();

    if (findErr) return { data: null, error: mapError(findErr) };
    if (!lead) return { data: null, error: { message: 'Lead not found', code: 'NOT_FOUND' } };

    const { data, error } = await supabase
      .from('leads')
      .update({
        name: updateData.name,
        profession: updateData.profession,
        email: updateData.email,
        status: updateData.status,
        partner_or_owner: updateData.partnerOrOwner,
        years_of_practice: updateData.yearsOfPractice,
        address: updateData.address as any,
        metadata: updateData.metadata
          ? ({ ...(lead.metadata as any || {}), ...updateData.metadata } as any)
          : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) return { data: null, error: mapError(error) };

    // Record status change event
    if (updateData.status && updateData.status !== lead.status) {
      await supabase.from('lead_events').insert({
        tenant_id: tenantId,
        lead_id: id,
        event_type: 'status_changed',
        payload: { from: lead.status, to: updateData.status } as any,
      });
    }

    return { data, error: null };
  },

  /** Soft-delete a lead */
  delete: async (tenantId: string, id: string) => {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('leads')
      .update({
        deleted_at: now,
        status: 'ARCHIVED' as const,
        updated_at: now,
      })
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) return { success: false, error: mapError(error) };

    await supabase.from('lead_events').insert({
      tenant_id: tenantId,
      lead_id: id,
      event_type: 'deleted',
      payload: { reason: 'manual_soft_delete' } as any,
    });

    return { success: true, error: null };
  },

  /** Opt-out a lead */
  optout: async (tenantId: string, id: string, reason?: string) => {
    const { data: lead, error: findErr } = await supabase
      .from('leads')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();

    if (findErr) return { success: false, error: mapError(findErr) };
    if (!lead) return { success: false, error: { message: 'Lead not found', code: 'NOT_FOUND' } };

    await supabase.from('optouts').upsert(
      {
        tenant_id: tenantId,
        whatsapp: lead.whatsapp,
        reason: reason || 'Lead request',
        source: 'manual',
      },
      { onConflict: 'tenant_id,whatsapp' }
    );

    await supabase
      .from('leads')
      .update({ status: 'OPTED_OUT' as const, updated_at: new Date().toISOString() })
      .eq('id', id);

    await supabase.from('lead_events').insert({
      tenant_id: tenantId,
      lead_id: id,
      event_type: 'optout',
      payload: { reason: reason || 'manual_optout' } as any,
    });

    return { success: true, error: null };
  },

  /** Add a note to a lead */
  addNote: async (tenantId: string, leadId: string, content: string, authorId?: string) => {
    const { data, error } = await supabase
      .from('lead_notes')
      .insert({
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        lead_id: leadId,
        author_id: authorId || null,
        content,
      })
      .select()
      .single();

    if (error) return { data: null, error: mapError(error) };
    return { data, error: null };
  },

  /** Get notes for a lead */
  getNotes: async (tenantId: string, leadId: string) => {
    const { data, error } = await supabase
      .from('lead_notes')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false });

    if (error) return { data: [], error: mapError(error) };
    return { data: data ?? [], error: null };
  },

  /** Get timeline events for a lead */
  getEvents: async (tenantId: string, leadId: string) => {
    const { data, error } = await supabase
      .from('lead_events')
      .select('id, event_type, payload, actor_id, created_at')
      .eq('tenant_id', tenantId)
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) return { data: [], error: mapError(error) };
    return {
      data: (data ?? []).map((e) => ({
        id: String(e.id),
        eventType: e.event_type,
        payload: e.payload,
        actorId: e.actor_id,
        createdAt: e.created_at,
      })),
      error: null,
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// CAMPAIGNS
// ═══════════════════════════════════════════════════════════════════════════════

export const campaignsQueries = {
  /** List non-archived campaigns */
  list: async (tenantId: string) => {
    const { data, error } = await supabase
      .from('campaigns')
      .select('*')
      .eq('tenant_id', tenantId)
      .neq('status', 'ARCHIVED' as CampaignStatus)
      .order('created_at', { ascending: false });

    if (error) return { data: [], error: mapError(error) };
    return { data: data ?? [], error: null };
  },

  /** Get single campaign by ID */
  getById: async (tenantId: string, id: string) => {
    const { data, error } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error) return { data: null, error: mapError(error) };
    return { data, error: null };
  },

  /** Create a new campaign */
  create: async (tenantId: string, campaignData: {
    name: string;
    profession: Profession;
    cities: string[];
    neighborhoods?: string[];
    dailyLimit?: number;
    hourWindowStart?: number;
    hourWindowEnd?: number;
    activeScriptId?: string;
    filters?: Record<string, unknown>;
  }) => {
    const { data, error } = await supabase
      .from('campaigns')
      .insert({
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        name: campaignData.name,
        profession: campaignData.profession,
        cities: campaignData.cities,
        neighborhoods: campaignData.neighborhoods || [],
        daily_limit: campaignData.dailyLimit ?? 100,
        hour_window_start: campaignData.hourWindowStart ?? 9,
        hour_window_end: campaignData.hourWindowEnd ?? 18,
        active_script_id: campaignData.activeScriptId,
        filters: (campaignData.filters || { min_fit_score: 6.0 }) as any,
        status: 'DRAFT' as const,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) return { data: null, error: mapError(error) };
    return { data, error: null };
  },

  /** Update campaign fields */
  update: async (tenantId: string, id: string, updateData: {
    name?: string;
    profession?: Profession;
    cities?: string[];
    neighborhoods?: string[];
    dailyLimit?: number;
    hourWindowStart?: number;
    hourWindowEnd?: number;
    activeScriptId?: string;
    filters?: Record<string, unknown>;
  }) => {
    // Verify campaign exists and isn't archived
    const { data: campaign, error: findErr } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (findErr) return { data: null, error: mapError(findErr) };
    if (!campaign) return { data: null, error: { message: 'Campaign not found', code: 'NOT_FOUND' } };
    if (campaign.status === 'ARCHIVED') return { data: null, error: { message: 'Cannot update an archived campaign', code: 'BAD_REQUEST' } };

    const { data, error } = await supabase
      .from('campaigns')
      .update({
        name: updateData.name,
        profession: updateData.profession,
        cities: updateData.cities,
        neighborhoods: updateData.neighborhoods,
        daily_limit: updateData.dailyLimit,
        hour_window_start: updateData.hourWindowStart,
        hour_window_end: updateData.hourWindowEnd,
        active_script_id: updateData.activeScriptId,
        filters: updateData.filters
          ? ({ ...(campaign.filters as any || {}), ...updateData.filters } as any)
          : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) return { data: null, error: mapError(error) };
    return { data, error: null };
  },

  /** Pause an active campaign */
  pause: async (tenantId: string, id: string) => {
    const { data, error } = await supabase
      .from('campaigns')
      .update({ status: 'PAUSED' as const, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'ACTIVE' as CampaignStatus)
      .select()
      .single();

    if (error) return { data: null, error: mapError(error) };
    return { data, error: null };
  },

  /** Resume a paused/draft campaign */
  resume: async (tenantId: string, id: string) => {
    const { data: campaign, error: findErr } = await supabase
      .from('campaigns')
      .select('status')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (findErr) return { data: null, error: mapError(findErr) };
    if (!campaign) return { data: null, error: { message: 'Campaign not found', code: 'NOT_FOUND' } };
    if (campaign.status !== 'PAUSED' && campaign.status !== 'DRAFT') {
      return { data: null, error: { message: `Cannot activate campaign with status ${campaign.status}`, code: 'BAD_REQUEST' } };
    }

    const { data, error } = await supabase
      .from('campaigns')
      .update({ status: 'ACTIVE' as const, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) return { data: null, error: mapError(error) };
    return { data, error: null };
  },

  /** Soft-delete (archive) campaign */
  delete: async (tenantId: string, id: string) => {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('campaigns')
      .update({ status: 'ARCHIVED' as const, archived_at: now, updated_at: now })
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) return { success: false, error: mapError(error) };
    return { success: true, error: null };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// CONVERSATIONS
// ═══════════════════════════════════════════════════════════════════════════════

export interface ConversationWithLead extends Conversation {
  leads: (Lead & { health_profiles: Tables['health_profiles']['Row'][] | null }) | null;
}

export const conversationsQueries = {
  /** List conversations with embedded lead data (cursor pagination) */
  list: async (tenantId: string, params: CursorPaginationParams = {}) => {
    const { limit = 50, cursor } = params;

    let query = supabase
      .from('conversations')
      .select('*, leads(*, health_profiles(*))')
      .eq('tenant_id', tenantId)
      .order('last_message_at', { ascending: false })
      .limit(limit + 1);

    if (cursor) query = query.lt('id', cursor);

    const { data, error } = await query;
    if (error) return { data: [], nextCursor: null, error: mapError(error) };

    const list = (data ?? []) as ConversationWithLead[];
    let nextCursor: string | null = null;
    if (list.length > limit) {
      const last = list.pop();
      nextCursor = last!.id;
    }

    return { data: list, nextCursor, error: null };
  },

  /** Get single conversation by ID */
  getById: async (tenantId: string, id: string) => {
    const { data, error } = await supabase
      .from('conversations')
      .select('*, leads(*)')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error) return { data: null, error: mapError(error) };
    return { data, error: null };
  },

  /** Get messages for a conversation (cursor pagination, ascending) */
  getMessages: async (conversationId: string, tenantId: string, params: CursorPaginationParams = {}) => {
    const { limit = 100, cursor } = params;

    let query = supabase
      .from('messages')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(limit + 1);

    if (cursor) query = query.gt('id', cursor);

    const { data, error } = await query;
    if (error) return { data: [], nextCursor: null, error: mapError(error) };

    const list = data ?? [];
    let nextCursor: string | null = null;
    if (list.length > limit) {
      const last = list.pop();
      nextCursor = last!.id;
    }

    return { data: list, nextCursor, error: null };
  },

  /** Send a manual message (creates DB record; actual sending requires backend queue) */
  sendMessage: async (tenantId: string, conversationId: string, content: string) => {
    // Verify conversation exists and AI handling is off
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('ai_handling')
      .eq('id', conversationId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (convErr) return { data: null, error: mapError(convErr) };
    if (!conv) return { data: null, error: { message: 'Conversation not found', code: 'NOT_FOUND' } };
    if (conv.ai_handling) {
      return { data: null, error: { message: 'Cannot send manual messages while AI is handling', code: 'AI_HANDLING_ACTIVE' } };
    }

    const { data, error } = await supabase
      .from('messages')
      .insert({
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        conversation_id: conversationId,
        direction: 'OUTBOUND' as const,
        sender: 'USER' as const,
        content,
        delivery_status: 'QUEUED' as const,
      })
      .select()
      .single();

    if (error) return { data: null, error: mapError(error) };
    return { data, error: null };
  },

  /** Toggle AI handling on a conversation */
  update: async (tenantId: string, id: string, aiHandling: boolean) => {
    const status: ConversationStatus = aiHandling ? 'ACTIVE' : 'PAUSED';
    const { data, error } = await supabase
      .from('conversations')
      .update({ ai_handling: aiHandling, status })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) return { data: null, error: mapError(error) };
    return { data, error: null };
  },

  /** Create a new manual conversation for a lead */
  create: async (tenantId: string, leadId: string, userId?: string) => {
    // Check lead exists
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();

    if (leadErr) return { data: null, error: mapError(leadErr) };
    if (!lead) return { data: null, error: { message: 'Lead not found', code: 'NOT_FOUND' } };

    // Check for existing active conversation
    const { data: existing } = await supabase
      .from('conversations')
      .select('*, leads(*)')
      .eq('tenant_id', tenantId)
      .eq('lead_id', leadId)
      .in('status', ['ACTIVE', 'PAUSED', 'ESCALATED'] as ConversationStatus[])
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) return { data: existing, error: null, isExisting: true };

    const conversationId = crypto.randomUUID();
    const { data: created, error: createErr } = await supabase
      .from('conversations')
      .insert({
        id: conversationId,
        tenant_id: tenantId,
        lead_id: leadId,
        status: 'PAUSED' as const,
        ai_handling: false,
      })
      .select('*, leads(*)')
      .single();

    if (createErr) return { data: null, error: mapError(createErr) };

    // Update lead status if CAPTURED
    if (lead.status === 'CAPTURED') {
      await supabase
        .from('leads')
        .update({ status: 'CONTACTED' as const, contacted_at: new Date().toISOString() })
        .eq('id', leadId);
    }

    // Record event
    await supabase.from('lead_events').insert({
      tenant_id: tenantId,
      lead_id: leadId,
      event_type: 'conversation_started',
      actor_id: userId || null,
      payload: { conversation_id: created.id, source: 'manual' } as any,
    });

    return { data: created, error: null, isExisting: false };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// MEETINGS
// ═══════════════════════════════════════════════════════════════════════════════

export const meetingsQueries = {
  /** List meetings for the tenant */
  list: async (tenantId: string) => {
    const { data, error } = await supabase
      .from('meetings')
      .select('*, leads(id, name, email, whatsapp)')
      .eq('tenant_id', tenantId)
      .order('scheduled_for', { ascending: false })
      .limit(100);

    if (error) return { data: [], error: mapError(error) };
    return { data: data ?? [], error: null };
  },

  /** Create a new manual meeting */
  create: async (tenantId: string, meetingData: {
    leadId: string;
    scheduledFor: string;
    durationMinutes?: number;
    location?: string;
  }, userId?: string) => {
    // Verify lead exists
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('id')
      .eq('id', meetingData.leadId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();

    if (leadErr) return { data: null, error: mapError(leadErr) };
    if (!lead) return { data: null, error: { message: 'Lead not found', code: 'NOT_FOUND' } };

    // Check for scheduling conflict
    const { data: conflict } = await supabase
      .from('meetings')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('scheduled_for', meetingData.scheduledFor)
      .in('status', ['SCHEDULED', 'CONFIRMED'] as MeetingStatus[])
      .maybeSingle();

    if (conflict) {
      return { data: null, error: { message: 'There is already a meeting at this time', code: 'SCHEDULE_CONFLICT' } };
    }

    const meetingId = crypto.randomUUID();
    const { data, error } = await supabase
      .from('meetings')
      .insert({
        id: meetingId,
        tenant_id: tenantId,
        lead_id: meetingData.leadId,
        scheduled_for: meetingData.scheduledFor,
        duration_minutes: meetingData.durationMinutes ?? 30,
        location: meetingData.location || null,
        status: 'SCHEDULED' as const,
        updated_at: new Date().toISOString(),
      })
      .select('*, leads(id, name, email, whatsapp)')
      .single();

    if (error) return { data: null, error: mapError(error) };

    // Update lead status
    await supabase
      .from('leads')
      .update({ status: 'MEETING_SCHEDULED' as const, updated_at: new Date().toISOString() })
      .eq('id', meetingData.leadId);

    // Record event
    await supabase.from('lead_events').insert({
      tenant_id: tenantId,
      lead_id: meetingData.leadId,
      event_type: 'meeting_scheduled',
      actor_id: userId || null,
      payload: { meeting_id: data.id, scheduled_for: meetingData.scheduledFor, source: 'manual' } as any,
    });

    return { data, error: null };
  },

  /** Update meeting outcome, status, and commissions */
  update: async (tenantId: string, id: string, updateData: {
    outcome?: MeetingOutcome;
    policy_value_cents?: number;
    commission_cents?: number;
    status?: MeetingStatus;
  }, userId?: string) => {
    // Find meeting
    const { data: meeting, error: findErr } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (findErr) return { data: null, error: mapError(findErr) };
    if (!meeting) return { data: null, error: { message: 'Meeting not found', code: 'NOT_FOUND' } };

    const { data, error } = await supabase
      .from('meetings')
      .update({
        outcome: updateData.outcome,
        policy_value_cents: updateData.policy_value_cents,
        commission_cents: updateData.commission_cents,
        status: updateData.status || (updateData.outcome ? 'HAPPENED' as const : undefined),
        outcome_marked_at: updateData.outcome ? new Date().toISOString() : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) return { data: null, error: mapError(error) };

    // Side effects for CLOSED outcome
    if (updateData.outcome === 'CLOSED') {
      const now = new Date().toISOString();
      await supabase
        .from('leads')
        .update({ status: 'CLOSED_WON' as const, closed_at: now, updated_at: now })
        .eq('id', meeting.lead_id);

      await supabase.from('lead_events').insert({
        tenant_id: tenantId,
        lead_id: meeting.lead_id,
        event_type: 'sale_closed',
        actor_id: userId || null,
        payload: {
          description: `Venda fechada! Apólice: R$ ${(updateData.policy_value_cents || 0) / 100}`,
          policy_value_cents: updateData.policy_value_cents,
          commission_cents: updateData.commission_cents,
        } as any,
      });
    }

    return { data, error: null };
  },

  /** Reschedule a meeting (cancel old, create new linked one) */
  reschedule: async (tenantId: string, meetingId: string, newTime: string, userId?: string) => {
    const { data: oldMeeting, error: findErr } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', meetingId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (findErr) return { data: null, error: mapError(findErr) };
    if (!oldMeeting) return { data: null, error: { message: 'Meeting not found', code: 'NOT_FOUND' } };

    // Cancel old meeting
    await supabase
      .from('meetings')
      .update({ status: 'CANCELLED' as const, updated_at: new Date().toISOString() })
      .eq('id', oldMeeting.id);

    // Create new linked meeting
    const newMeetingId = crypto.randomUUID();
    const { data, error } = await supabase
      .from('meetings')
      .insert({
        id: newMeetingId,
        tenant_id: tenantId,
        lead_id: oldMeeting.lead_id,
        scheduled_for: newTime,
        duration_minutes: oldMeeting.duration_minutes,
        location: oldMeeting.location,
        status: 'SCHEDULED' as const,
        rescheduled_from_id: oldMeeting.id,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) return { data: null, error: mapError(error) };

    await supabase.from('lead_events').insert({
      tenant_id: tenantId,
      lead_id: oldMeeting.lead_id,
      event_type: 'meeting_rescheduled',
      actor_id: userId || null,
      payload: {
        description: `Reunião remarcada de ${oldMeeting.scheduled_for} para ${newTime}`,
        old_meeting_id: oldMeeting.id,
        new_meeting_id: data.id,
      } as any,
    });

    return { data, error: null };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SCRIPTS
// ═══════════════════════════════════════════════════════════════════════════════

export interface ScriptWithVariations extends Script {
  variations: ScriptVariation[];
}

export const scriptsQueries = {
  /** List scripts with active variations */
  list: async (tenantId: string) => {
    const { data, error } = await supabase
      .from('scripts')
      .select('*, script_variations(*)')
      .eq('tenant_id', tenantId)
      .is('archived_at', null)
      .order('created_at', { ascending: false });

    if (error) return { data: [], error: mapError(error) };

    const result = (data ?? []).map((s: any) => ({
      ...s,
      variations: (s.script_variations || [])
        .filter((v: any) => v.active)
        .sort((a: any, b: any) => (a.variant_letter || '').localeCompare(b.variant_letter || '')),
      script_variations: undefined,
    }));

    return { data: result as ScriptWithVariations[], error: null };
  },

  /** Create a new script */
  create: async (tenantId: string, scriptData: {
    name?: string;
    category?: string;
    baseMessage?: string;
    targetProfession?: Profession;
    variables?: string[];
  }) => {
    const scriptId = crypto.randomUUID();
    const { data, error } = await supabase
      .from('scripts')
      .insert({
        id: scriptId,
        tenant_id: tenantId,
        name: scriptData.name || 'Novo Roteiro',
        category: (scriptData.category || 'APPROACH') as any,
        target_profession: scriptData.targetProfession || null,
        base_message: scriptData.baseMessage || '',
        status: 'DRAFT' as const,
        variables: scriptData.variables || [],
        updated_at: new Date().toISOString(),
      })
      .select('*, script_variations(*)')
      .single();

    if (error) return { data: null, error: mapError(error) };
    return {
      data: { ...data, variations: data.script_variations || [], script_variations: undefined } as ScriptWithVariations,
      error: null,
    };
  },

  /** Update a script (and optionally replace variations) */
  update: async (tenantId: string, id: string, updateData: {
    name?: string;
    baseMessage?: string;
    status?: ScriptStatus;
    flow?: Record<string, unknown>;
    variations?: Array<{ content: string; message?: string; weight?: number }>;
  }) => {
    // Verify script exists
    const { data: existing, error: findErr } = await supabase
      .from('scripts')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (findErr) return { data: null, error: mapError(findErr) };
    if (!existing) return { data: null, error: { message: 'Script not found', code: 'NOT_FOUND' } };

    const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (updateData.name !== undefined) updatePayload.name = updateData.name;
    if (updateData.baseMessage !== undefined) updatePayload.base_message = updateData.baseMessage;
    if (updateData.status !== undefined) updatePayload.status = updateData.status;
    if (updateData.flow !== undefined) updatePayload.flow = updateData.flow;

    await supabase.from('scripts').update(updatePayload as any).eq('id', id);

    // Replace variations if provided
    if (Array.isArray(updateData.variations)) {
      await supabase.from('script_variations').delete().eq('script_id', id).eq('tenant_id', tenantId);

      for (let i = 0; i < updateData.variations.length; i++) {
        const v = updateData.variations[i];
        if (!v) continue;
        await supabase.from('script_variations').insert({
          id: crypto.randomUUID(),
          tenant_id: tenantId,
          script_id: id,
          variant_letter: String.fromCharCode(65 + i),
          message: v.content || v.message || '',
          weight: (v.weight || 50) / 100,
          active: true,
          updated_at: new Date().toISOString(),
        });
      }
    }

    // Re-fetch updated script
    const { data, error } = await supabase
      .from('scripts')
      .select('*, script_variations(*)')
      .eq('id', id)
      .single();

    if (error) return { data: null, error: mapError(error) };
    return {
      data: {
        ...data,
        variations: (data.script_variations || []).filter((v: any) => v.active),
        script_variations: undefined,
      } as ScriptWithVariations,
      error: null,
    };
  },

  /** Archive a script */
  delete: async (tenantId: string, id: string) => {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('scripts')
      .update({ archived_at: now, status: 'ARCHIVED' as const, updated_at: now })
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) return { success: false, error: mapError(error) };
    return { success: true, error: null };
  },

  /** Clone a global script template into a tenant script */
  clone: async (tenantId: string, templateId: string) => {
    const { data: template, error: findErr } = await supabase
      .from('script_templates')
      .select('*')
      .eq('id', templateId)
      .eq('active', true)
      .maybeSingle();

    if (findErr) return { data: null, error: mapError(findErr) };
    if (!template) return { data: null, error: { message: 'Active template not found', code: 'NOT_FOUND' } };

    const scriptId = crypto.randomUUID();
    const { data, error } = await supabase
      .from('scripts')
      .insert({
        id: scriptId,
        tenant_id: tenantId,
        cloned_from_template_id: template.id,
        name: `${template.name} (Clonado)`,
        category: template.category,
        target_profession: template.target_profession,
        flow: template.flow_template,
        base_message: template.base_message_template,
        variables: template.variables,
        status: 'DRAFT' as const,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) return { data: null, error: mapError(error) };
    return { data, error: null };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

export const notificationsQueries = {
  /** List notifications for a user with unread count */
  list: async (tenantId: string, userId: string) => {
    const [notifRes, countRes] = await Promise.all([
      supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('tenant_id', tenantId)
        .is('read_at', null),
    ]);

    if (notifRes.error) return { data: [], unreadCount: 0, error: mapError(notifRes.error) };
    return { data: notifRes.data ?? [], unreadCount: countRes.count ?? 0, error: null };
  },

  /** Mark a single notification as read */
  markRead: async (tenantId: string, id: string) => {
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) return { success: false, error: mapError(error) };
    return { success: true, error: null };
  },

  /** Mark all notifications as read for a user */
  markAllRead: async (tenantId: string, userId: string) => {
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .is('read_at', null);

    if (error) return { success: false, error: mapError(error) };
    return { success: true, error: null };
  },

  /** Get notification preferences for a user */
  getPreferences: async (userId: string) => {
    const { data, error } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId);

    if (error) return { data: [], error: mapError(error) };
    return { data: data ?? [], error: null };
  },

  /** Upsert notification preference */
  updatePreferences: async (userId: string, pref: {
    eventType: string;
    channels: Enums['NotificationChannel'][];
    enabled?: boolean;
  }) => {
    const { data: existing } = await supabase
      .from('notification_preferences')
      .select('id')
      .eq('user_id', userId)
      .eq('event_type', pref.eventType)
      .maybeSingle();

    if (existing) {
      const { data, error } = await supabase
        .from('notification_preferences')
        .update({
          channels: pref.channels,
          enabled: pref.enabled ?? true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) return { data: null, error: mapError(error) };
      return { data, error: null };
    }

    const { data, error } = await supabase
      .from('notification_preferences')
      .insert({
        id: crypto.randomUUID(),
        user_id: userId,
        event_type: pref.eventType,
        channels: pref.channels,
        enabled: pref.enabled ?? true,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) return { data: null, error: mapError(error) };
    return { data, error: null };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// BILLING
// ═══════════════════════════════════════════════════════════════════════════════

const PLAN_LABELS: Record<string, string> = {
  STARTER: 'Starter',
  STANDARD: 'Standard',
  PREMIUM: 'Premium',
};

export const billingQueries = {
  /** Get billing overview: tenant info, current usage, invoices */
  get: async (tenantId: string) => {
    const periodMonthISO = startOfMonth();

    const [tenantRes, usageRes, invoicesRes] = await Promise.all([
      supabase
        .from('tenants')
        .select('id, name, plan, mrr_cents, status')
        .eq('id', tenantId)
        .is('deleted_at', null)
        .single(),
      supabase
        .from('tenant_usage')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('period_month', periodMonthISO)
        .maybeSingle(),
      supabase
        .from('tenant_billing')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('due_at', { ascending: false })
        .limit(12),
    ]);

    if (tenantRes.error || !tenantRes.data) {
      return { data: null, error: { message: 'Tenant not found', code: 'NOT_FOUND' } };
    }

    const tenant = tenantRes.data;
    const currentUsage = usageRes.data;
    const invoices = invoicesRes.data || [];

    const currentInvoice =
      invoices.find((inv) => inv.period_month === periodMonthISO) ||
      invoices.find((inv) => inv.status === 'PENDING' || inv.status === 'OVERDUE') ||
      invoices[0] ||
      null;

    return {
      data: {
        tenant: {
          id: tenant.id,
          name: tenant.name,
          plan: tenant.plan,
          planName: PLAN_LABELS[tenant.plan] || tenant.plan,
          mrrCents: tenant.mrr_cents,
          status: tenant.status,
        },
        usage: {
          periodMonth: periodMonthISO.slice(0, 10),
          llmTokensInput: Number(currentUsage?.llm_tokens_input || 0),
          llmTokensOutput: Number(currentUsage?.llm_tokens_output || 0),
          llmCostCents: currentUsage?.llm_cost_cents || 0,
          whatsappMessagesSent: currentUsage?.whatsapp_messages_sent || 0,
          whatsappCostCents: currentUsage?.whatsapp_cost_cents || 0,
          googleMapsCalls: currentUsage?.google_maps_calls || 0,
          googleMapsCostCents: currentUsage?.google_maps_cost_cents || 0,
          conversationsStarted: currentUsage?.conversations_started || 0,
          meetingsScheduled: currentUsage?.meetings_scheduled || 0,
        },
        currentInvoice: currentInvoice
          ? {
              id: currentInvoice.id,
              periodMonth: currentInvoice.period_month.slice(0, 10),
              mrrCents: currentInvoice.mrr_cents,
              excessCents: currentInvoice.excess_cents,
              totalCents: currentInvoice.total_cents,
              status: currentInvoice.status,
              paidAt: currentInvoice.paid_at || null,
              dueAt: currentInvoice.due_at,
              invoiceUrl: currentInvoice.invoice_url,
              paymentMethod: currentInvoice.payment_method,
            }
          : null,
        invoices: invoices.map((inv) => ({
          id: inv.id,
          periodMonth: inv.period_month.slice(0, 10),
          mrrCents: inv.mrr_cents,
          excessCents: inv.excess_cents,
          totalCents: inv.total_cents,
          status: inv.status,
          paidAt: inv.paid_at || null,
          dueAt: inv.due_at,
        })),
      },
      error: null,
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// LGPD
// ═══════════════════════════════════════════════════════════════════════════════

export const lgpdQueries = {
  /** List LGPD requests for a tenant */
  list: async (tenantId: string) => {
    const { data, error } = await supabase
      .from('lgpd_requests')
      .select('id, type, status, scope, download_url, download_expires_at, rejection_reason, created_at, processed_at, updated_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) return { data: [], error: mapError(error) };
    return { data: data ?? [], error: null };
  },

  /** Create a new LGPD request */
  create: async (tenantId: string, userId: string, type: LgpdRequestType, scope?: Record<string, unknown>) => {
    // Anti-abuse: max 3 pending
    const { count, error: countErr } = await supabase
      .from('lgpd_requests')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .in('status', ['PENDING', 'PROCESSING'] as LgpdRequestStatus[]);

    if (countErr) return { data: null, error: mapError(countErr) };
    if ((count ?? 0) >= 3) {
      return { data: null, error: { message: 'Você já tem 3 solicitações LGPD em andamento.', code: 'RATE_LIMITED' } };
    }

    const requestId = crypto.randomUUID();
    const { data, error } = await supabase
      .from('lgpd_requests')
      .insert({
        id: requestId,
        tenant_id: tenantId,
        requested_by_user_id: userId,
        type,
        status: 'PENDING' as const,
        scope: scope as any,
        updated_at: new Date().toISOString(),
      })
      .select('id, type, status, scope, created_at')
      .single();

    if (error) return { data: null, error: mapError(error) };
    return { data, error: null };
  },

  /** Get a single LGPD request */
  getById: async (tenantId: string, id: string) => {
    const { data, error } = await supabase
      .from('lgpd_requests')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error) return { data: null, error: mapError(error) };
    return { data, error: null };
  },

  /** Cancel a pending LGPD request */
  cancel: async (tenantId: string, id: string, reason?: string) => {
    const { data: existing, error: findErr } = await supabase
      .from('lgpd_requests')
      .select('id, status')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (findErr) return { data: null, error: mapError(findErr) };
    if (!existing) return { data: null, error: { message: 'Request not found', code: 'NOT_FOUND' } };
    if (existing.status !== 'PENDING') {
      return { data: null, error: { message: `Só é possível cancelar requests em PENDING (atual: ${existing.status})`, code: 'CONFLICT' } };
    }

    const { data, error } = await supabase
      .from('lgpd_requests')
      .update({
        status: 'CANCELED' as const,
        rejection_reason: reason ?? 'Cancelado pelo usuario',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id, status, rejection_reason, updated_at')
      .single();

    if (error) return { data: null, error: mapError(error) };
    return { data, error: null };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// REFERRALS / PARTNER CODE
// ═══════════════════════════════════════════════════════════════════════════════

export const referralsQueries = {
  /** Get the current user's referral/partner info */
  get: async (userId: string) => {
    const { data, error } = await supabase
      .from('users')
      .select('partner_code, partner_brand')
      .eq('id', userId)
      .maybeSingle();

    if (error) return { data: null, error: mapError(error) };
    return { data, error: null };
  },

  /** Register a partner code for the user */
  registerCode: async (userId: string, partnerCode: string, partnerBrand?: string) => {
    const { data, error } = await supabase
      .from('users')
      .update({
        partner_code: partnerCode,
        partner_brand: partnerBrand || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select('partner_code, partner_brand')
      .single();

    if (error) return { data: null, error: mapError(error) };
    return { data, error: null };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// PROFILE
// ═══════════════════════════════════════════════════════════════════════════════

export const profileQueries = {
  /** Get current user profile */
  get: async (userId: string, tenantId: string) => {
    const { data, error } = await supabase
      .from('users')
      .select('id, name, email, whatsapp, susep, role')
      .eq('id', userId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) return { data: null, error: mapError(error) };
    return { data, error: null };
  },

  /** Update current user profile */
  update: async (userId: string, tenantId: string, updateData: {
    name?: string;
    email?: string;
    susep?: string | null;
  }) => {
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (updateData.name !== undefined) payload.name = updateData.name;
    if (updateData.email !== undefined) payload.email = updateData.email;
    if (updateData.susep !== undefined) payload.susep = updateData.susep || null;

    const { data, error } = await supabase
      .from('users')
      .update(payload as any)
      .eq('id', userId)
      .eq('tenant_id', tenantId)
      .select('id, name, email, whatsapp, susep, role')
      .single();

    if (error) return { data: null, error: mapError(error) };
    return { data, error: null };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

function formatTime(date: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(date));
}

export interface DashboardTodayData {
  meetings_today: number;
  conversations_ready: number;
  pending_manual_conversations: number;
  need_callback: number;
  new_leads_today: number;
  next_meeting_time: string | null;
}

export interface DashboardFunnelData {
  stages: Record<string, number>;
  total_leads: number;
  metrics: {
    win_rate_percent: number;
    qualified_rate_percent: number;
  };
}

export interface DashboardPerformanceData {
  total_policy_cents: number;
  total_commission_cents: number;
  sales_count: number;
  goals: {
    configured: boolean;
    target_cents: number | null;
    progress_percent: number | null;
    goal_reached: boolean;
  };
}

export interface DashboardAiUsageData {
  llm_cost_cents: number;
  whatsapp_cost_cents: number;
  maps_cost_cents: number;
  total_costs_cents: number;
  limit: {
    max_limit_cents: number;
    used_percent: number;
    remaining_cents: number;
  };
}

export interface DashboardWeeklyCapturesData {
  label: string;
  value: number;
}

export interface DashboardHotLead {
  id: string;
  name: string;
  profession: string | null;
  whatsapp: string;
  city: string;
  fitScore: number;
  status: string;
  googleRating: number | null;
  googleReviewsCount: number | null;
  registrationNumber: string | null;
  createdAt: string;
  contactedAt: string | null;
  firstResponseAt: string | null;
}

export const dashboardQueries = {
  /**
   * Today's operational metrics.
   * Tries RPC first; falls back to multi-query client-side aggregation.
   */
  today: async (tenantId: string): Promise<{ data: DashboardTodayData; error: null } | { data: null; error: QueryError }> => {
    // Try RPC
    const { data: rpcData, error: rpcErr } = await supabase.rpc('dashboard_today', { p_tenant_id: tenantId });
    if (!rpcErr && rpcData) {
      const r = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      if (r) {
        // Fetch next meeting time (not in RPC)
        const { data: nextMeeting } = await supabase
          .from('meetings')
          .select('scheduled_for')
          .eq('tenant_id', tenantId)
          .gte('scheduled_for', new Date().toISOString())
          .in('status', ['SCHEDULED', 'CONFIRMED'] as MeetingStatus[])
          .order('scheduled_for', { ascending: true })
          .limit(1)
          .maybeSingle();

        return {
          data: {
            meetings_today: r.meetings_today ?? 0,
            conversations_ready: r.conversations_ready ?? 0,
            pending_manual_conversations: r.pending_manual ?? 0,
            need_callback: r.need_callback ?? 0,
            new_leads_today: r.new_leads_today ?? 0,
            next_meeting_time: nextMeeting ? formatTime(nextMeeting.scheduled_for) : null,
          },
          error: null,
        };
      }
    }

    // Fallback: parallel queries
    const { start, end } = todayRange();
    const scheduledStatuses: MeetingStatus[] = ['SCHEDULED', 'CONFIRMED'];

    const [meetingsRes, convReadyRes, pendingRes, callbackRes, newLeadsRes, nextMeetingRes] = await Promise.all([
      supabase.from('meetings')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .gte('scheduled_for', start)
        .lte('scheduled_for', end)
        .in('status', scheduledStatuses),
      supabase.from('conversations')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'ACTIVE' as ConversationStatus)
        .eq('ai_handling', true),
      supabase.from('conversations')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .in('status', ['PAUSED', 'ESCALATED'] as ConversationStatus[])
        .eq('ai_handling', false),
      supabase.from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'CONTACTED' as LeadStatus)
        .is('deleted_at', null),
      supabase.from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .gte('created_at', start)
        .lte('created_at', end)
        .is('deleted_at', null),
      supabase.from('meetings')
        .select('scheduled_for')
        .eq('tenant_id', tenantId)
        .gte('scheduled_for', new Date().toISOString())
        .in('status', scheduledStatuses)
        .order('scheduled_for', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    return {
      data: {
        meetings_today: meetingsRes.count ?? 0,
        conversations_ready: convReadyRes.count ?? 0,
        pending_manual_conversations: pendingRes.count ?? 0,
        need_callback: callbackRes.count ?? 0,
        new_leads_today: newLeadsRes.count ?? 0,
        next_meeting_time: nextMeetingRes.data ? formatTime(nextMeetingRes.data.scheduled_for) : null,
      },
      error: null,
    };
  },

  /** CRM funnel counts and conversion rates */
  funnel: async (tenantId: string, period?: 'week' | 'month' | '90d') => {
    // Try RPC
    const { data: rpcData, error: rpcErr } = await supabase.rpc('dashboard_funnel', { p_tenant_id: tenantId });
    if (!rpcErr && rpcData && Array.isArray(rpcData) && rpcData.length > 0) {
      const stages: Record<string, number> = {};
      let totalLeads = 0;
      for (const row of rpcData) {
        stages[row.status] = Number(row.cnt);
        totalLeads += Number(row.cnt);
      }
      const winRate = totalLeads > 0 ? ((stages['CLOSED_WON'] || 0) / totalLeads) * 100 : 0;
      const qualifiedRate = totalLeads > 0 ? (((stages['QUALIFIED'] || 0) + (stages['MEETING_SCHEDULED'] || 0) + (stages['CLOSED_WON'] || 0)) / totalLeads) * 100 : 0;

      return {
        data: {
          stages,
          total_leads: totalLeads,
          metrics: {
            win_rate_percent: Number(winRate.toFixed(1)),
            qualified_rate_percent: Number(qualifiedRate.toFixed(1)),
          },
        } as DashboardFunnelData,
        error: null,
      };
    }

    // Fallback
    let dateFilter: string | undefined;
    if (period === 'week') { const d = new Date(); d.setDate(d.getDate() - 7); d.setHours(0, 0, 0, 0); dateFilter = d.toISOString(); }
    else if (period === 'month') { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); dateFilter = d.toISOString(); }
    else if (period === '90d') { const d = new Date(); d.setDate(d.getDate() - 90); d.setHours(0, 0, 0, 0); dateFilter = d.toISOString(); }

    let query = supabase.from('leads').select('status').eq('tenant_id', tenantId);
    if (dateFilter) query = query.gte('created_at', dateFilter);

    const { data: leadRows, error } = await query;
    if (error) return { data: null, error: mapError(error) };

    const counts: Record<string, number> = {};
    let totalLeads = 0;
    (leadRows || []).forEach((row) => {
      const status = row.status as string;
      counts[status] = (counts[status] || 0) + 1;
      totalLeads++;
    });

    const winRate = totalLeads > 0 ? ((counts['CLOSED_WON'] || 0) / totalLeads) * 100 : 0;
    const qualifiedRate = totalLeads > 0 ? (((counts['QUALIFIED'] || 0) + (counts['MEETING_SCHEDULED'] || 0) + (counts['CLOSED_WON'] || 0)) / totalLeads) * 100 : 0;

    return {
      data: {
        stages: counts,
        total_leads: totalLeads,
        metrics: {
          win_rate_percent: Number(winRate.toFixed(1)),
          qualified_rate_percent: Number(qualifiedRate.toFixed(1)),
        },
      } as DashboardFunnelData,
      error: null,
    };
  },

  /** Revenue and commission performance */
  performance: async (tenantId: string, period?: 'week' | 'month' | '90d') => {
    // Try RPC
    const { data: rpcData, error: rpcErr } = await supabase.rpc('dashboard_performance', { p_tenant_id: tenantId });
    if (!rpcErr && rpcData) {
      const r = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      if (r) {
        return {
          data: {
            total_policy_cents: Number(r.total_policy_cents) || 0,
            total_commission_cents: Number(r.total_commission_cents) || 0,
            sales_count: Number(r.sales_count) || 0,
            goals: { configured: false, target_cents: null, progress_percent: null, goal_reached: false },
          } as DashboardPerformanceData,
          error: null,
        };
      }
    }

    // Fallback
    let dateFilter: string | undefined;
    if (period === 'week') { const d = new Date(); d.setDate(d.getDate() - 7); d.setHours(0, 0, 0, 0); dateFilter = d.toISOString(); }
    else if (period === 'month') { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); dateFilter = d.toISOString(); }
    else if (period === '90d') { const d = new Date(); d.setDate(d.getDate() - 90); d.setHours(0, 0, 0, 0); dateFilter = d.toISOString(); }

    let query = supabase.from('meetings')
      .select('policy_value_cents, commission_cents, id')
      .eq('tenant_id', tenantId)
      .eq('outcome', 'CLOSED' as MeetingOutcome);

    if (dateFilter) query = query.gte('outcome_marked_at', dateFilter);

    const { data: meetings, error } = await query;
    if (error) return { data: null, error: mapError(error) };

    let totalPolicy = 0;
    let totalCommission = 0;
    let salesCount = 0;
    (meetings || []).forEach((m) => {
      totalPolicy += m.policy_value_cents || 0;
      totalCommission += m.commission_cents || 0;
      salesCount++;
    });

    return {
      data: {
        total_policy_cents: totalPolicy,
        total_commission_cents: totalCommission,
        sales_count: salesCount,
        goals: { configured: false, target_cents: null, progress_percent: null, goal_reached: false },
      } as DashboardPerformanceData,
      error: null,
    };
  },

  /** AI / WhatsApp / Maps usage costs for the current month */
  aiUsage: async (tenantId: string): Promise<{ data: DashboardAiUsageData; error: null } | { data: null; error: QueryError }> => {
    // Try RPC
    const { data: rpcData, error: rpcErr } = await supabase.rpc('dashboard_ai_usage', { p_tenant_id: tenantId });
    if (!rpcErr && rpcData) {
      const r = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      if (r) {
        return {
          data: {
            llm_cost_cents: Number(r.llm_cost_cents) || 0,
            whatsapp_cost_cents: Number(r.whatsapp_cost_cents) || 0,
            maps_cost_cents: Number(r.maps_cost_cents) || 0,
            total_costs_cents: Number(r.total_costs_cents) || 0,
            limit: {
              max_limit_cents: Number(r.max_limit_cents) || 0,
              used_percent: Number(r.used_percent) || 0,
              remaining_cents: Number(r.remaining_cents) || 0,
            },
          },
          error: null,
        };
      }
    }

    // Fallback
    const periodMonth = startOfMonth();

    const [usageRes, tenantRes] = await Promise.all([
      supabase.from('tenant_usage').select('*').eq('tenant_id', tenantId).eq('period_month', periodMonth).maybeSingle(),
      supabase.from('tenants').select('plan').eq('id', tenantId).single(),
    ]);

    const usage = usageRes.data;
    const llmCost = usage ? Number(usage.llm_cost_cents) : 0;
    const whatsappCost = usage ? Number(usage.whatsapp_cost_cents) : 0;
    const mapsCost = usage ? Number(usage.google_maps_cost_cents) : 0;
    const totalCost = llmCost + whatsappCost + mapsCost;

    // Fallback plan limits
    const planLimits: Record<string, number> = { STARTER: 5000, STANDARD: 15000, PREMIUM: 50000 };
    const maxLimitCents = planLimits[tenantRes.data?.plan || 'STARTER'] || 5000;
    const usedPercent = maxLimitCents > 0 ? (totalCost / maxLimitCents) * 100 : 0;

    return {
      data: {
        llm_cost_cents: llmCost,
        whatsapp_cost_cents: whatsappCost,
        maps_cost_cents: mapsCost,
        total_costs_cents: totalCost,
        limit: {
          max_limit_cents: maxLimitCents,
          used_percent: Number(usedPercent.toFixed(1)),
          remaining_cents: Math.max(0, maxLimitCents - totalCost),
        },
      },
      error: null,
    };
  },

  /** Weekly capture chart (last 7 days) */
  weeklyCaptures: async (tenantId: string) => {
    // Try RPC
    const { data: rpcData, error: rpcErr } = await supabase.rpc('dashboard_weekly_captures', { p_tenant_id: tenantId });
    if (!rpcErr && rpcData && Array.isArray(rpcData) && rpcData.length > 0) {
      const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
      return {
        data: rpcData.map((row: any) => ({
          label: dayNames[new Date(row.capture_date).getDay()] || '',
          value: Number(row.cnt) || 0,
        })) as DashboardWeeklyCapturesData[],
        error: null,
      };
    }

    // Fallback
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const { data: leads, error } = await supabase
      .from('leads')
      .select('created_at')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .gte('created_at', sevenDaysAgo.toISOString());

    if (error) return { data: [], error: mapError(error) };

    const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      d.setHours(0, 0, 0, 0);
      return { date: d, label: dayNames[d.getDay()]!, count: 0 };
    });

    (leads || []).forEach((lead) => {
      const created = new Date(lead.created_at);
      created.setHours(0, 0, 0, 0);
      const match = days.find((d) => d.date.getTime() === created.getTime());
      if (match) match.count++;
    });

    return {
      data: days.map((d) => ({ label: d.label, value: d.count })) as DashboardWeeklyCapturesData[],
      error: null,
    };
  },

  /** Top leads by fit_score */
  hotLeads: async (tenantId: string, limit = 5) => {
    // Try RPC
    const { data: rpcData, error: rpcErr } = await supabase.rpc('dashboard_hot_leads', { p_tenant_id: tenantId });
    if (!rpcErr && rpcData && Array.isArray(rpcData) && rpcData.length > 0) {
      return {
        data: rpcData.map((l: any) => ({
          id: l.id,
          name: l.name || 'Lead sem nome',
          profession: l.profession,
          whatsapp: l.whatsapp,
          city: (typeof l.address === 'object' && l.address?.city) || '',
          fitScore: Number(l.fit_score) || 0,
          status: l.status,
          googleRating: l.google_rating ? Number(l.google_rating) : null,
          googleReviewsCount: l.google_reviews_count,
          registrationNumber: l.registration_number,
          createdAt: l.created_at,
          contactedAt: l.contacted_at || null,
          firstResponseAt: l.first_response_at || null,
        })) as DashboardHotLead[],
        error: null,
      };
    }

    // Fallback
    const { data: leads, error } = await supabase
      .from('leads')
      .select('id, name, profession, whatsapp, address, fit_score, status, google_rating, google_reviews_count, registration_number, created_at, contacted_at, first_response_at')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .not('status', 'in', '("ARCHIVED","OPTED_OUT","CLOSED_LOST")')
      .not('fit_score', 'is', null)
      .order('fit_score', { ascending: false })
      .limit(limit);

    if (error) return { data: [], error: mapError(error) };

    return {
      data: (leads || []).map((l) => ({
        id: l.id,
        name: l.name || 'Lead sem nome',
        profession: l.profession,
        whatsapp: l.whatsapp,
        city: (l.address as any)?.city || '',
        fitScore: Number(l.fit_score) || 0,
        status: l.status,
        googleRating: l.google_rating ? Number(l.google_rating) : null,
        googleReviewsCount: l.google_reviews_count,
        registrationNumber: l.registration_number,
        createdAt: l.created_at,
        contactedAt: l.contacted_at || null,
        firstResponseAt: l.first_response_at || null,
      })) as DashboardHotLead[],
      error: null,
    };
  },
};
