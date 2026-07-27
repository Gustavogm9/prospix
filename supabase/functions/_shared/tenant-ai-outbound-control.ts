export const TENANT_AI_OUTBOUND_PAUSED_REASON = 'TENANT_AI_OUTBOUND_PAUSED';
export const TENANT_AI_OUTBOUND_CONTROL_UNAVAILABLE_REASON =
  'TENANT_AI_OUTBOUND_CONTROL_UNAVAILABLE';

export type TenantAiOutboundGate = {
  allow: boolean;
  paused: boolean;
  reasonCode: string | null;
  pauseReason: string | null;
  pausedAt: string | null;
  updatedAt: string | null;
  error: string | null;
};

function blockedGate(reasonCode: string, error: string | null = null): TenantAiOutboundGate {
  return {
    allow: false,
    paused: true,
    reasonCode,
    pauseReason: null,
    pausedAt: null,
    updatedAt: null,
    error,
  };
}

export async function loadTenantAiOutboundGate(
  supabase: any,
  tenantId: string | null | undefined,
): Promise<TenantAiOutboundGate> {
  if (!tenantId) {
    return blockedGate(TENANT_AI_OUTBOUND_CONTROL_UNAVAILABLE_REASON, 'tenant_id_missing');
  }

  try {
    const { data, error } = await supabase
      .from('tenant_ai_outbound_controls')
      .select('paused, paused_at, pause_reason, updated_at')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error) {
      return blockedGate(TENANT_AI_OUTBOUND_CONTROL_UNAVAILABLE_REASON, error.message || 'query_failed');
    }

    const paused = data?.paused === true;
    return {
      allow: !paused,
      paused,
      reasonCode: paused ? TENANT_AI_OUTBOUND_PAUSED_REASON : null,
      pauseReason: data?.pause_reason || null,
      pausedAt: data?.paused_at || null,
      updatedAt: data?.updated_at || null,
      error: null,
    };
  } catch (err) {
    return blockedGate(
      TENANT_AI_OUTBOUND_CONTROL_UNAVAILABLE_REASON,
      err instanceof Error ? err.message : String(err),
    );
  }
}

export function tenantAiOutboundPausedRetryIso(minutes = 5): string {
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 5;
  return new Date(Date.now() + safeMinutes * 60 * 1000).toISOString();
}
