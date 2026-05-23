/**
 * Tipos de API.
 *
 * Tipos low-level (paths, components, request/response bodies) sao gerados
 * automaticamente em ./openapi.generated.ts pelo openapi-typescript.
 *
 * Este arquivo expoe tipos curados/usados frequentemente + envelopes comuns.
 *
 * CI valida drift entre docs/api/openapi.yaml e openapi.generated.ts via
 * `pnpm --filter @prospix/shared-types verify:openapi`.
 */

// ── Tipos gerados (re-export) ───────────────────────────────────────────────
export type {
  paths as ApiPaths,
  components as ApiComponents,
  operations as ApiOperations,
  webhooks as ApiWebhooks,
} from './openapi.generated.js';
import type { components as _Components } from './openapi.generated.js';

/** Atalho: schema gerado pelo OpenAPI (ex.: `Schema<'Lead'>`). */
export type Schema<K extends keyof _Components['schemas']> = _Components['schemas'][K];

// ── Headers padrão de toda request /tenant/* ────────────────────────────────
export interface TenantRequestHeaders {
  authorization: string; // "Bearer <jwt>"
  'x-tenant-id': string;
  'x-request-id'?: string;
  'idempotency-key'?: string;
}

// ── Paginação cursor-based ──────────────────────────────────────────────────
export interface PaginationMeta {
  next_cursor: string | null;
  has_more: boolean;
  total_estimate?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
  meta: {
    request_id: string;
    timestamp: string;
  };
}

// ── Single resource response ────────────────────────────────────────────────
export interface SingleResponse<T> {
  data: T;
  meta: {
    request_id: string;
    timestamp: string;
  };
}

// ── Error response ──────────────────────────────────────────────────────────
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    trace_id?: string;
  };
  meta: {
    request_id: string;
    timestamp: string;
  };
}

// ── Drift gate: endpoints criticos validados em apps/api/tests/unit ──────────
export type ApiResponseShape = 'raw-array' | 'raw-object' | 'data-array' | 'data-object' | 'empty';
export type ApiErrorShape = 'flat-error' | 'nested-error';

export interface CriticalApiContract {
  id: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  successStatus: number;
  successShape: ApiResponseShape;
  validationErrorStatus?: number;
  validationErrorShape?: ApiErrorShape;
}

export const CRITICAL_API_CONTRACTS = [
  {
    id: 'tenant.conversations.list',
    method: 'GET',
    path: '/tenant/conversations',
    successStatus: 200,
    successShape: 'raw-array',
  },
  {
    id: 'tenant.conversations.messages.list',
    method: 'GET',
    path: '/tenant/conversations/{id}/messages',
    successStatus: 200,
    successShape: 'raw-array',
  },
  {
    id: 'tenant.conversations.messages.create',
    method: 'POST',
    path: '/tenant/conversations/{id}/messages',
    successStatus: 201,
    successShape: 'raw-object',
    validationErrorStatus: 400,
    validationErrorShape: 'flat-error',
  },
  {
    id: 'tenant.conversations.update',
    method: 'PATCH',
    path: '/tenant/conversations/{id}',
    successStatus: 200,
    successShape: 'raw-object',
    validationErrorStatus: 400,
    validationErrorShape: 'flat-error',
  },
  {
    id: 'tenant.scripts.list',
    method: 'GET',
    path: '/tenant/scripts',
    successStatus: 200,
    successShape: 'raw-array',
  },
  {
    id: 'tenant.scripts.create',
    method: 'POST',
    path: '/tenant/scripts',
    successStatus: 201,
    successShape: 'raw-object',
    validationErrorStatus: 400,
    validationErrorShape: 'flat-error',
  },
  {
    id: 'tenant.scripts.simulate',
    method: 'POST',
    path: '/tenant/scripts/simulate',
    successStatus: 200,
    successShape: 'raw-object',
    validationErrorStatus: 400,
    validationErrorShape: 'flat-error',
  },
  {
    id: 'tenant.scripts.clone',
    method: 'POST',
    path: '/tenant/scripts/clone',
    successStatus: 201,
    successShape: 'raw-object',
    validationErrorStatus: 400,
    validationErrorShape: 'flat-error',
  },
  {
    id: 'tenant.scripts.update',
    method: 'PATCH',
    path: '/tenant/scripts/{id}',
    successStatus: 200,
    successShape: 'raw-object',
    validationErrorStatus: 400,
    validationErrorShape: 'flat-error',
  },
  {
    id: 'tenant.scripts.variations.upsert',
    method: 'POST',
    path: '/tenant/scripts/{id}/variations',
    successStatus: 201,
    successShape: 'raw-object',
    validationErrorStatus: 400,
    validationErrorShape: 'flat-error',
  },
  {
    id: 'tenant.scripts.test',
    method: 'POST',
    path: '/tenant/scripts/{id}/test',
    successStatus: 200,
    successShape: 'raw-object',
  },
  {
    id: 'tenant.leads.list',
    method: 'GET',
    path: '/tenant/leads',
    successStatus: 200,
    successShape: 'data-array',
    validationErrorStatus: 400,
    validationErrorShape: 'flat-error',
  },
  {
    id: 'tenant.leads.create',
    method: 'POST',
    path: '/tenant/leads',
    successStatus: 201,
    successShape: 'raw-object',
    validationErrorStatus: 400,
    validationErrorShape: 'flat-error',
  },
  {
    id: 'tenant.leads.detail',
    method: 'GET',
    path: '/tenant/leads/{id}',
    successStatus: 200,
    successShape: 'raw-object',
  },
  {
    id: 'tenant.leads.update',
    method: 'PATCH',
    path: '/tenant/leads/{id}',
    successStatus: 200,
    successShape: 'raw-object',
    validationErrorStatus: 400,
    validationErrorShape: 'flat-error',
  },
  {
    id: 'tenant.leads.delete',
    method: 'DELETE',
    path: '/tenant/leads/{id}',
    successStatus: 204,
    successShape: 'empty',
  },
  {
    id: 'tenant.leads.optout',
    method: 'POST',
    path: '/tenant/leads/{id}/optout',
    successStatus: 200,
    successShape: 'raw-object',
  },
  {
    id: 'tenant.leads.notes.create',
    method: 'POST',
    path: '/tenant/leads/{id}/notes',
    successStatus: 201,
    successShape: 'raw-object',
    validationErrorStatus: 400,
    validationErrorShape: 'flat-error',
  },
  {
    id: 'tenant.leads.notes.list',
    method: 'GET',
    path: '/tenant/leads/{id}/notes',
    successStatus: 200,
    successShape: 'raw-array',
  },
  {
    id: 'tenant.dashboard.today',
    method: 'GET',
    path: '/tenant/dashboard/today',
    successStatus: 200,
    successShape: 'data-object',
  },
  {
    id: 'tenant.dashboard.funnel',
    method: 'GET',
    path: '/tenant/dashboard/funnel',
    successStatus: 200,
    successShape: 'data-object',
  },
  {
    id: 'tenant.dashboard.aiUsage',
    method: 'GET',
    path: '/tenant/dashboard/ai-usage',
    successStatus: 200,
    successShape: 'data-object',
  },
  // NOTE · contratos campaigns/dashboard-performance/LGPD requests existem na
  // implementacao mas precisam: (1) `x-prospix-error-shape: nested-error` no
  // OpenAPI dos endpoints com validacao; (2) handlers retornando status real
  // sob test fixtures sem DB. Entrarao no gate critico incrementalmente.
  // Tracking: AUD-P1-013/014 incremental.
  {
    id: 'tenant.meetings.list',
    method: 'GET',
    path: '/tenant/meetings',
    successStatus: 200,
    successShape: 'data-array',
  },
  {
    id: 'tenant.meetings.update',
    method: 'PATCH',
    path: '/tenant/meetings/{id}',
    successStatus: 200,
    successShape: 'data-object',
    validationErrorStatus: 400,
    validationErrorShape: 'flat-error',
  },
  {
    id: 'tenant.meetings.reschedule',
    method: 'POST',
    path: '/tenant/meetings/reschedule',
    successStatus: 201,
    successShape: 'data-object',
    validationErrorStatus: 400,
    validationErrorShape: 'flat-error',
  },
  {
    id: 'tenant.notifications.preferences.list',
    method: 'GET',
    path: '/tenant/notifications/preferences',
    successStatus: 200,
    successShape: 'data-array',
  },
  {
    id: 'tenant.notifications.preferences.upsert',
    method: 'PUT',
    path: '/tenant/notifications/preferences',
    successStatus: 200,
    successShape: 'data-object',
    validationErrorStatus: 400,
    validationErrorShape: 'flat-error',
  },
  {
    id: 'tenant.integrations.google.oauth',
    method: 'GET',
    path: '/tenant/integrations/google/oauth',
    successStatus: 200,
    successShape: 'raw-object',
  },
  {
    id: 'tenant.integrations.whatsapp.status',
    method: 'GET',
    path: '/tenant/integrations/whatsapp/status',
    successStatus: 200,
    successShape: 'raw-object',
  },
  {
    id: 'tenant.integrations.whatsapp.connect',
    method: 'POST',
    path: '/tenant/integrations/whatsapp/connect',
    successStatus: 200,
    successShape: 'raw-object',
  },
  {
    id: 'tenant.integrations.whatsapp.disconnect',
    method: 'POST',
    path: '/tenant/integrations/whatsapp/disconnect',
    successStatus: 200,
    successShape: 'raw-object',
  },
  {
    id: 'auth.magicLink',
    method: 'POST',
    path: '/auth/magic-link',
    successStatus: 200,
    successShape: 'raw-object',
    validationErrorStatus: 400,
    validationErrorShape: 'flat-error',
  },
  {
    id: 'auth.adminLogin',
    method: 'POST',
    path: '/auth/admin-login',
    successStatus: 200,
    successShape: 'raw-object',
    validationErrorStatus: 400,
    validationErrorShape: 'flat-error',
  },
  {
    id: 'auth.invitations.verify',
    method: 'POST',
    path: '/auth/invitations/verify',
    successStatus: 200,
    successShape: 'data-object',
    validationErrorStatus: 400,
    validationErrorShape: 'flat-error',
  },
  {
    id: 'auth.invitations.redeem',
    method: 'POST',
    path: '/auth/invitations/redeem',
    successStatus: 201,
    successShape: 'data-object',
    validationErrorStatus: 400,
    validationErrorShape: 'flat-error',
  },
  {
    id: 'admin.tenants.list',
    method: 'GET',
    path: '/admin/tenants',
    successStatus: 200,
    successShape: 'data-array',
  },
  {
    id: 'admin.tenants.detail',
    method: 'GET',
    path: '/admin/tenants/{id}',
    successStatus: 200,
    successShape: 'data-object',
  },
  {
    id: 'admin.tenants.create',
    method: 'POST',
    path: '/admin/tenants',
    successStatus: 201,
    successShape: 'raw-object',
    validationErrorStatus: 400,
    validationErrorShape: 'flat-error',
  },
  {
    id: 'admin.tenants.update',
    method: 'PATCH',
    path: '/admin/tenants/{id}',
    successStatus: 200,
    successShape: 'data-object',
    validationErrorStatus: 400,
    validationErrorShape: 'flat-error',
  },
  {
    id: 'admin.tenants.suspend',
    method: 'POST',
    path: '/admin/tenants/{id}/suspend',
    successStatus: 200,
    successShape: 'raw-object',
  },
  {
    id: 'admin.tenants.resume',
    method: 'POST',
    path: '/admin/tenants/{id}/resume',
    successStatus: 200,
    successShape: 'raw-object',
  },
  {
    id: 'admin.tenants.churn',
    method: 'POST',
    path: '/admin/tenants/{id}/churn',
    successStatus: 200,
    successShape: 'raw-object',
  },
  {
    id: 'admin.tenants.invitations.list',
    method: 'GET',
    path: '/admin/tenants/{id}/invitations',
    successStatus: 200,
    successShape: 'data-array',
  },
  {
    id: 'admin.tenants.invitations.create',
    method: 'POST',
    path: '/admin/tenants/{id}/invitations',
    successStatus: 201,
    successShape: 'raw-object',
  },
  {
    id: 'admin.tenants.invitations.revoke',
    method: 'DELETE',
    path: '/admin/tenants/{id}/invitations/{invitationId}',
    successStatus: 200,
    successShape: 'raw-object',
  },
  {
    id: 'admin.usage.consolidated',
    method: 'GET',
    path: '/admin/usage/consolidated',
    successStatus: 200,
    successShape: 'data-array',
  },
  {
    id: 'admin.billing.list',
    method: 'GET',
    path: '/admin/billing',
    successStatus: 200,
    successShape: 'data-array',
  },
  {
    id: 'admin.billing.payManual',
    method: 'PATCH',
    path: '/admin/billing/{id}/pay',
    successStatus: 200,
    successShape: 'data-object',
  },
  {
    id: 'admin.templates.list',
    method: 'GET',
    path: '/admin/templates',
    successStatus: 200,
    successShape: 'data-array',
  },
  {
    id: 'admin.templates.create',
    method: 'POST',
    path: '/admin/templates',
    successStatus: 201,
    successShape: 'data-object',
    validationErrorStatus: 400,
    validationErrorShape: 'flat-error',
  },
  {
    id: 'admin.templates.update',
    method: 'PATCH',
    path: '/admin/templates/{id}',
    successStatus: 200,
    successShape: 'data-object',
    validationErrorStatus: 400,
    validationErrorShape: 'flat-error',
  },
  {
    id: 'admin.templates.delete',
    method: 'DELETE',
    path: '/admin/templates/{id}',
    successStatus: 200,
    successShape: 'raw-object',
  },
  {
    id: 'webhooks.evolution.unified',
    method: 'POST',
    path: '/webhooks/evolution',
    successStatus: 200,
    successShape: 'raw-object',
  },
  {
    id: 'webhooks.asaas',
    method: 'POST',
    path: '/webhooks/asaas',
    successStatus: 200,
    successShape: 'raw-object',
    validationErrorStatus: 400,
    validationErrorShape: 'flat-error',
  },
] as const satisfies readonly CriticalApiContract[];
