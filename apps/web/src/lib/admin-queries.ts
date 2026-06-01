/**
 * Admin Supabase Queries Module
 *
 * Cross-tenant queries for Guilds Admin panel.
 * Uses `supabaseAdmin` which stores session in sessionStorage
 * (closing tab = logout).
 *
 * @module admin-queries
 */

import { supabaseAdmin } from './supabase';
import type { Database } from '../../../api/src/lib/database.types';

type Tables = Database['public']['Tables'];

export type Tenant = Tables['tenants']['Row'];
export type User = Tables['users']['Row'];
export type OperationalAlert = Tables['operational_alerts']['Row'];
export type TenantUsage = Tables['tenant_usage']['Row'];
export type TenantBilling = Tables['tenant_billing']['Row'];

// ─── Helpers ────────────────────────────────────────────────────────────────────

interface QueryError {
  message: string;
  code?: string;
  details?: string;
}

function mapError(error: unknown): QueryError {
  if (error && typeof error === 'object' && 'message' in error) {
    const e = error as { message: string; code?: string; details?: string };
    return { message: e.message, code: e.code, details: e.details };
  }
  return { message: 'Unknown error' };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TENANTS (cross-tenant admin view)
// ═══════════════════════════════════════════════════════════════════════════════

export const adminTenantsQueries = {
  /** List all tenants with optional status filter */
  list: async (filters?: { status?: string; search?: string }) => {
    let query = supabaseAdmin
      .from('tenants')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (filters?.status) query = query.eq('status', filters.status);
    if (filters?.search) {
      query = query.or(`name.ilike.%${filters.search}%,slug.ilike.%${filters.search}%`);
    }

    const { data, error } = await query;
    if (error) return { data: [], error: mapError(error) };
    return { data: data ?? [], error: null };
  },

  /** Get a single tenant by ID with users */
  getById: async (tenantId: string) => {
    const [tenantRes, usersRes] = await Promise.all([
      supabaseAdmin
        .from('tenants')
        .select('*')
        .eq('id', tenantId)
        .maybeSingle(),
      supabaseAdmin
        .from('users')
        .select('id, name, email, role, whatsapp, last_login_at, created_at')
        .eq('tenant_id', tenantId)
        .is('deleted_at', null),
    ]);

    if (tenantRes.error) return { data: null, error: mapError(tenantRes.error) };
    return {
      data: tenantRes.data ? { ...tenantRes.data, users: usersRes.data ?? [] } : null,
      error: null,
    };
  },

  /** Update tenant status (e.g., ONBOARDING → ACTIVE, ACTIVE → SUSPENDED) */
  updateStatus: async (tenantId: string, status: string) => {
    const { data, error } = await supabaseAdmin
      .from('tenants')
      .update({ status: status as any, updated_at: new Date().toISOString() })
      .eq('id', tenantId)
      .select()
      .single();

    if (error) return { data: null, error: mapError(error) };
    return { data, error: null };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// USERS (cross-tenant admin view)
// ═══════════════════════════════════════════════════════════════════════════════

export const adminUsersQueries = {
  /** List all users (across all tenants) */
  list: async (filters?: { tenantId?: string; role?: string; search?: string }) => {
    let query = supabaseAdmin
      .from('users')
      .select('*, tenants(name, slug)')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (filters?.tenantId) query = query.eq('tenant_id', filters.tenantId);
    if (filters?.role) query = query.eq('role', filters.role);
    if (filters?.search) {
      query = query.or(`name.ilike.%${filters.search}%,email.ilike.%${filters.search}%`);
    }

    const { data, error } = await query;
    if (error) return { data: [], error: mapError(error) };
    return { data: data ?? [], error: null };
  },

  /** Check email uniqueness (needed for cross-tenant validations) */
  isEmailUnique: async (email: string, excludeUserId?: string) => {
    let query = supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .is('deleted_at', null);

    if (excludeUserId) query = query.neq('id', excludeUserId);

    const { data, error } = await query;
    if (error) return { isUnique: false, error: mapError(error) };
    return { isUnique: (data ?? []).length === 0, error: null };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// OPERATIONAL ALERTS
// ═══════════════════════════════════════════════════════════════════════════════

export const adminAlertsQueries = {
  /** List operational alerts (newest first, can filter by severity or tenant) */
  list: async (filters?: { severity?: string; tenantId?: string; resolved?: boolean }) => {
    let query = supabaseAdmin
      .from('operational_alerts')
      .select('*, tenants(name)')
      .order('created_at', { ascending: false })
      .limit(100);

    if (filters?.severity) query = query.eq('severity', filters.severity);
    if (filters?.tenantId) query = query.eq('tenant_id', filters.tenantId);
    if (filters?.resolved === true) query = query.not('resolved_at', 'is', null);
    if (filters?.resolved === false) query = query.is('resolved_at', null);

    const { data, error } = await query;
    if (error) return { data: [], error: mapError(error) };
    return { data: data ?? [], error: null };
  },

  /** Acknowledge an alert */
  acknowledge: async (alertId: string, userId: string) => {
    const { data, error } = await supabaseAdmin
      .from('operational_alerts')
      .update({ ack_at: new Date().toISOString(), ack_by_id: userId, updated_at: new Date().toISOString() })
      .eq('id', alertId)
      .select()
      .single();

    if (error) return { data: null, error: mapError(error) };
    return { data, error: null };
  },

  /** Resolve an alert */
  resolve: async (alertId: string) => {
    const { data, error } = await supabaseAdmin
      .from('operational_alerts')
      .update({ resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', alertId)
      .select()
      .single();

    if (error) return { data: null, error: mapError(error) };
    return { data, error: null };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// LGPD ADMIN (process requests across tenants)
// ═══════════════════════════════════════════════════════════════════════════════

export const adminLgpdQueries = {
  /** List all pending/processing LGPD requests across tenants */
  listPending: async () => {
    const { data, error } = await supabaseAdmin
      .from('lgpd_requests')
      .select('*, tenants(name)')
      .in('status', ['PENDING', 'PROCESSING'])
      .order('created_at', { ascending: true });

    if (error) return { data: [], error: mapError(error) };
    return { data: data ?? [], error: null };
  },

  /** Mark a request as processing */
  markProcessing: async (requestId: string) => {
    const { data, error } = await supabaseAdmin
      .from('lgpd_requests')
      .update({ status: 'PROCESSING' as const, updated_at: new Date().toISOString() })
      .eq('id', requestId)
      .select()
      .single();

    if (error) return { data: null, error: mapError(error) };
    return { data, error: null };
  },

  /** Complete a request (with optional download URL) */
  complete: async (requestId: string, downloadUrl?: string) => {
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('lgpd_requests')
      .update({
        status: 'COMPLETED' as const,
        processed_at: now,
        download_url: downloadUrl || null,
        download_expires_at: downloadUrl
          ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
          : null,
        updated_at: now,
      })
      .eq('id', requestId)
      .select()
      .single();

    if (error) return { data: null, error: mapError(error) };
    return { data, error: null };
  },

  /** Reject a request */
  reject: async (requestId: string, reason: string) => {
    const { data, error } = await supabaseAdmin
      .from('lgpd_requests')
      .update({
        status: 'REJECTED' as const,
        rejection_reason: reason,
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .select()
      .single();

    if (error) return { data: null, error: mapError(error) };
    return { data, error: null };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// BILLING ADMIN
// ═══════════════════════════════════════════════════════════════════════════════

export const adminBillingQueries = {
  /** Get global billing overview: total MRR, overdue invoices, etc. */
  overview: async () => {
    const [tenantsRes, overdueRes] = await Promise.all([
      supabaseAdmin
        .from('tenants')
        .select('mrr_cents, plan, status')
        .is('deleted_at', null)
        .in('status', ['ACTIVE', 'ONBOARDING']),
      supabaseAdmin
        .from('tenant_billing')
        .select('*, tenants(name)')
        .eq('status', 'OVERDUE')
        .order('due_at', { ascending: true }),
    ]);

    let totalMrrCents = 0;
    const planDistribution: Record<string, number> = {};
    (tenantsRes.data ?? []).forEach((t) => {
      totalMrrCents += t.mrr_cents;
      planDistribution[t.plan] = (planDistribution[t.plan] || 0) + 1;
    });

    return {
      data: {
        totalMrrCents,
        activeTenantsCount: (tenantsRes.data ?? []).length,
        planDistribution,
        overdueInvoices: (overdueRes.data ?? []).map((inv: any) => ({
          id: inv.id,
          tenantName: inv.tenants?.name || 'Unknown',
          periodMonth: inv.period_month,
          totalCents: inv.total_cents,
          dueAt: inv.due_at,
        })),
      },
      error: null,
    };
  },

  /** Mark invoice as paid */
  markPaid: async (invoiceId: string, paymentMethod?: string) => {
    const { data, error } = await supabaseAdmin
      .from('tenant_billing')
      .update({
        status: 'PAID' as const,
        paid_at: new Date().toISOString(),
        payment_method: paymentMethod || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoiceId)
      .select()
      .single();

    if (error) return { data: null, error: mapError(error) };
    return { data, error: null };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SCRIPT TEMPLATES (global, not tenant-scoped)
// ═══════════════════════════════════════════════════════════════════════════════

export const adminScriptTemplatesQueries = {
  /** List all active script templates */
  list: async () => {
    const { data, error } = await supabaseAdmin
      .from('script_templates')
      .select('*')
      .eq('active', true)
      .order('popularity', { ascending: false });

    if (error) return { data: [], error: mapError(error) };
    return { data: data ?? [], error: null };
  },
};
