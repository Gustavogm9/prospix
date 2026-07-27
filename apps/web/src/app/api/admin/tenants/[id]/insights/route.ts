import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, supabaseAdmin } from '../../../../_lib/auth';

type CountResult = { count: number; error: string | null };

function startOfMonth(date = new Date()): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
}

function addMonths(date: Date, delta: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1));
}

function emptyCredentialState() {
  return {
    exists: false,
    evolution: {
      baseUrlConfigured: false,
      instanceConfigured: false,
      tokenConfigured: false,
      webhookConfigured: false,
    },
    google: {
      calendarConfigured: false,
      oauthConnected: false,
      oauthScope: null as string | null,
      mapsConfigured: false,
    },
    ai: {
      provider: null as string | null,
      openaiConfigured: false,
      anthropicConfigured: false,
      googleConfigured: false,
    },
    telephony: {
      accountConfigured: false,
      tokenConfigured: false,
    },
    updatedAt: null as string | null,
  };
}

async function safeCount(
  label: string,
  queryFactory: () => PromiseLike<{ count: number | null; error: any }>,
): Promise<CountResult> {
  try {
    const { count, error } = await queryFactory();
    if (error) {
      console.warn(`admin tenant insights count failed: ${label}`, error.message);
      return { count: 0, error: error.message || String(error) };
    }
    return { count: count ?? 0, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`admin tenant insights count exception: ${label}`, message);
    return { count: 0, error: message };
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const { id: tenantId } = await params;

  try {
    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .select('id, status')
      .eq('id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();

    if (tenantError) throw tenantError;
    if (!tenant) {
      return NextResponse.json(
        { error: 'RESOURCE_NOT_FOUND', message: 'Tenant not found' },
        { status: 404 },
      );
    }

    const [leads, activeConversations, totalConversations, activeScripts, lgpdPending, meetingsScheduled] =
      await Promise.all([
        safeCount('leads', () =>
          supabaseAdmin
            .from('leads')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenantId)
            .is('deleted_at', null),
        ),
        safeCount('conversations_active', () =>
          supabaseAdmin
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenantId)
            .eq('status', 'ACTIVE'),
        ),
        safeCount('conversations_total', () =>
          supabaseAdmin
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenantId),
        ),
        safeCount('scripts_active', () =>
          supabaseAdmin
            .from('scripts')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenantId)
            .eq('status', 'ACTIVE'),
        ),
        safeCount('lgpd_pending', () =>
          supabaseAdmin
            .from('lgpd_requests')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenantId)
            .in('status', ['PENDING', 'PROCESSING']),
        ),
        safeCount('meetings_scheduled', () =>
          supabaseAdmin
            .from('meetings')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenantId)
            .in('status', ['SCHEDULED', 'CONFIRMED']),
        ),
      ]);

    const threeMonthsAgo = startOfMonth(addMonths(new Date(), -2));
    const [{ data: usageRows, error: usageError }, { data: billingRows, error: billingError }, { data: secrets }] =
      await Promise.all([
        supabaseAdmin
          .from('tenant_usage')
          .select(
            'period_month, llm_cost_cents, whatsapp_cost_cents, google_maps_cost_cents, llm_tokens_input, llm_tokens_output, whatsapp_messages_sent, meetings_scheduled',
          )
          .eq('tenant_id', tenantId)
          .gte('period_month', threeMonthsAgo)
          .order('period_month', { ascending: true }),
        supabaseAdmin
          .from('tenant_billing')
          .select('id, period_month, total_cents, status, due_at, paid_at')
          .eq('tenant_id', tenantId)
          .order('period_month', { ascending: false })
          .limit(6),
        supabaseAdmin
          .from('tenant_secrets')
          .select(
            'tenant_id, evolution_base_url, evolution_instance_name, evolution_api_key_encrypted, evolution_webhook_secret, google_calendar_id, google_oauth_refresh_encrypted, google_oauth_scope, google_maps_api_key_encrypted, ai_provider, openai_api_key_encrypted, anthropic_api_key_encrypted, google_ai_api_key_encrypted, twilio_account_sid_encrypted, twilio_auth_token_encrypted, updated_at',
          )
          .eq('tenant_id', tenantId)
          .maybeSingle(),
      ]);

    if (usageError) console.warn('admin tenant insights usage failed', usageError.message);
    if (billingError) console.warn('admin tenant insights billing failed', billingError.message);

    const credentialState = secrets ? {
      exists: true,
      evolution: {
        baseUrlConfigured: Boolean(secrets.evolution_base_url),
        instanceConfigured: Boolean(secrets.evolution_instance_name),
        tokenConfigured: Boolean(secrets.evolution_api_key_encrypted),
        webhookConfigured: Boolean(secrets.evolution_webhook_secret),
      },
      google: {
        calendarConfigured: Boolean(secrets.google_calendar_id),
        oauthConnected: Boolean(secrets.google_oauth_refresh_encrypted),
        oauthScope: secrets.google_oauth_scope ?? null,
        mapsConfigured: Boolean(secrets.google_maps_api_key_encrypted),
      },
      ai: {
        provider: secrets.ai_provider ?? null,
        openaiConfigured: Boolean(secrets.openai_api_key_encrypted),
        anthropicConfigured: Boolean(secrets.anthropic_api_key_encrypted),
        googleConfigured: Boolean(secrets.google_ai_api_key_encrypted),
      },
      telephony: {
        accountConfigured: Boolean(secrets.twilio_account_sid_encrypted),
        tokenConfigured: Boolean(secrets.twilio_auth_token_encrypted),
      },
      updatedAt: secrets.updated_at ?? null,
    } : emptyCredentialState();

    const missing: string[] = [];
    if (!credentialState.evolution.baseUrlConfigured) missing.push('Evolution Base URL');
    if (!credentialState.evolution.instanceConfigured) missing.push('Evolution Instance');
    if (!credentialState.evolution.tokenConfigured) missing.push('Evolution API Token');
    if (!credentialState.ai.openaiConfigured && !credentialState.ai.anthropicConfigured && !credentialState.ai.googleConfigured) {
      missing.push('AI provider key');
    }

    const integrationHealth = {
      status: missing.length === 0 ? 'excellent' : missing.length <= 2 ? 'fair' : 'critical',
      missing,
    };

    const usage3m = (usageRows ?? []).map((row) => ({
      periodMonth: String(row.period_month).slice(0, 10),
      llmCostCents: row.llm_cost_cents || 0,
      whatsappCostCents: row.whatsapp_cost_cents || 0,
      googleMapsCostCents: row.google_maps_cost_cents || 0,
      totalCostCents:
        (row.llm_cost_cents || 0) +
        (row.whatsapp_cost_cents || 0) +
        (row.google_maps_cost_cents || 0),
      llmTokensInput: row.llm_tokens_input || 0,
      llmTokensOutput: row.llm_tokens_output || 0,
      whatsappMessagesSent: row.whatsapp_messages_sent || 0,
    }));

    const billing = (billingRows ?? []).map((row) => ({
      id: row.id,
      periodMonth: String(row.period_month).slice(0, 10),
      totalCents: row.total_cents || 0,
      status: row.status,
      dueAt: row.due_at,
      paidAt: row.paid_at ?? null,
    }));

    return NextResponse.json({
      success: true,
      data: {
        counts: {
          leads: leads.count,
          conversationsActive: activeConversations.count,
          conversationsTotal: totalConversations.count,
          scriptsActive: activeScripts.count,
          lgpdPending: lgpdPending.count,
          meetingsScheduled: meetingsScheduled.count,
        },
        usage3m,
        billing,
        credentialState,
        integrationHealth,
        warnings: [
          leads.error,
          activeConversations.error,
          totalConversations.error,
          activeScripts.error,
          lgpdPending.error,
          meetingsScheduled.error,
          usageError?.message ?? null,
          billingError?.message ?? null,
        ].filter(Boolean),
      },
    });
  } catch (err) {
    console.error('admin/tenants/[id]/insights failed', err);
    return NextResponse.json(
      { error: 'INTERNAL', message: 'Falha ao carregar indicadores do tenant.' },
      { status: 500 },
    );
  }
}
