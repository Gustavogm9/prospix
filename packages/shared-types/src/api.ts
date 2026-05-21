/**
 * Tipos de API derivados do OpenAPI.
 *
 * Frente A: gerar via `openapi-typescript docs/api/openapi.yaml -o packages/shared-types/src/openapi.generated.ts`
 * e reexportar aqui os tipos de Request/Response mais usados.
 */

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
