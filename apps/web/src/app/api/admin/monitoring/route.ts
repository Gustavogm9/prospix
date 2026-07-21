import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, supabaseAdmin } from '../_lib/auth';

const E164_RE = /^\+[1-9][0-9]{7,14}$/;

function normalizeWhatsapp(value: unknown): string {
  const raw = String(value ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  return `+${digits}`;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function sanitizeTenantIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value
    .map((id) => String(id || '').trim())
    .filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  return ids.length > 0 ? Array.from(new Set(ids)) : null;
}

function channelStatus() {
  const adminConfigured = Boolean(
    process.env.ADMIN_REPORT_EVOLUTION_BASE_URL
      && process.env.ADMIN_REPORT_EVOLUTION_INSTANCE_NAME
      && process.env.ADMIN_REPORT_EVOLUTION_API_KEY,
  );

  const fallbackConfigured = Boolean(
    process.env.EVOLUTION_GUILDS_INSTANCE
      && process.env.EVOLUTION_GUILDS_API_KEY,
  );

  return {
    configured: adminConfigured || fallbackConfigured,
    source: adminConfigured ? 'ADMIN_REPORT_EVOLUTION_*' : 'EVOLUTION_GUILDS_*',
    instanceName: adminConfigured
      ? process.env.ADMIN_REPORT_EVOLUTION_INSTANCE_NAME || null
      : process.env.EVOLUTION_GUILDS_INSTANCE || null,
    baseUrlConfigured: Boolean(process.env.ADMIN_REPORT_EVOLUTION_BASE_URL || process.env.EVOLUTION_BASE_URL),
  };
}

function errorResponse(message: string, status = 400, code = 'VALIDATION') {
  return NextResponse.json({ ok: false, error: code, message }, { status });
}

async function audit(adminId: string, action: string, targetType: string, targetId: string | null, payload: unknown) {
  await supabaseAdmin.from('audit_log').insert({
    user_id: adminId,
    action,
    target_type: targetType,
    target_id: targetId,
    payload,
  });
}

async function invokeDispatcher(payload: Record<string, unknown>) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_FUNCTIONS_NOT_CONFIGURED');
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/admin-monitoring-dispatcher`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ ...payload, source: 'admin-api' }),
  });

  const text = await response.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { ok: false, error: text.slice(0, 500) };
  }

  if (!response.ok || data?.ok === false) {
    throw new Error(data?.message || data?.error || `Dispatcher HTTP ${response.status}`);
  }

  return data;
}

async function dispatcherChannelStatus() {
  try {
    const data = await invokeDispatcher({ mode: 'status' });
    return {
      ...(data.channel || channelStatus()),
      dispatcherReachable: true,
      dispatcherError: null,
    };
  } catch (err: any) {
    return {
      ...channelStatus(),
      dispatcherReachable: false,
      dispatcherError: err?.message || 'Dispatcher status unavailable',
    };
  }
}

async function loadDashboard() {
  const [
    channel,
    recipientsRes,
    schedulesRes,
    runsRes,
    deliveriesRes,
    tenantsRes,
  ] = await Promise.all([
    dispatcherChannelStatus(),
    supabaseAdmin
      .from('admin_monitoring_recipients')
      .select('*')
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('admin_monitoring_schedules')
      .select('*, admin_monitoring_recipients(id, label, whatsapp, active)')
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('admin_monitoring_report_runs')
      .select('id, schedule_id, recipient_id, status, period_start, period_end, metrics, ai_summary, error, started_at, completed_at, created_at')
      .order('created_at', { ascending: false })
      .limit(25),
    supabaseAdmin
      .from('admin_disconnect_alert_deliveries')
      .select('id, connection_event_id, operational_alert_id, tenant_id, recipient_id, incident_key, status, reason_code, external_state, ai_summary, error, created_at, sent_at, tenants(id, name, slug), admin_monitoring_recipients(id, label, whatsapp)')
      .order('created_at', { ascending: false })
      .limit(25),
    supabaseAdmin
      .from('tenants')
      .select('id, name, slug, status')
      .is('deleted_at', null)
      .order('name', { ascending: true }),
  ]);

  for (const result of [recipientsRes, schedulesRes, runsRes, deliveriesRes, tenantsRes]) {
    if (result.error) throw result.error;
  }

  const recipients = recipientsRes.data || [];
  const schedules = schedulesRes.data || [];
  const runs = runsRes.data || [];
  const deliveries = deliveriesRes.data || [];

  return {
    ok: true,
    channel,
    summary: {
      recipients: recipients.length,
      activeRecipients: recipients.filter((r: any) => r.active).length,
      activeSchedules: schedules.filter((s: any) => s.active).length,
      failedReports24h: runs.filter((r: any) => r.status === 'FAILED').length,
      disconnectAlerts24h: deliveries.length,
    },
    recipients,
    schedules,
    reportRuns: runs,
    disconnectDeliveries: deliveries,
    tenants: tenantsRes.data || [],
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  try {
    return NextResponse.json(await loadDashboard());
  } catch (err) {
    console.error('admin/monitoring GET failed', err);
    return errorResponse('Falha ao carregar monitoramento administrativo.', 500, 'INTERNAL');
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return errorResponse('JSON invalido.', 400);
  }

  try {
    if (body.action === 'create_recipient') {
      const label = String(body.label || '').trim();
      const whatsapp = normalizeWhatsapp(body.whatsapp);
      if (label.length < 2) return errorResponse('Nome do destinatario e obrigatorio.');
      if (!E164_RE.test(whatsapp)) return errorResponse('WhatsApp deve estar em E.164. Exemplo: +5517999999999.');

      const { data, error } = await supabaseAdmin
        .from('admin_monitoring_recipients')
        .insert({
          label,
          whatsapp,
          active: asBoolean(body.active, true),
          report_enabled: asBoolean(body.reportEnabled, true),
          disconnect_alerts_enabled: asBoolean(body.disconnectAlertsEnabled, true),
          notes: String(body.notes || '').trim() || null,
          created_by_id: auth.adminId,
        })
        .select('*')
        .single();

      if (error) throw error;
      await audit(auth.adminId, 'admin_monitoring.recipient.create', 'admin_monitoring_recipient', data.id, { label, whatsapp });
      return NextResponse.json({ ok: true, recipient: data }, { status: 201 });
    }

    if (body.action === 'create_schedule') {
      const name = String(body.name || '').trim();
      const recipientId = String(body.recipientId || '').trim();
      const intervalMinutes = asInteger(body.intervalMinutes, 60);
      const windowMinutes = asInteger(body.windowMinutes, 60);
      if (name.length < 3) return errorResponse('Nome da agenda e obrigatorio.');
      if (!recipientId) return errorResponse('Destinatario e obrigatorio.');
      if (intervalMinutes < 5 || intervalMinutes > 1440) return errorResponse('Intervalo deve ficar entre 5 e 1440 minutos.');
      if (windowMinutes < 5 || windowMinutes > 10080) return errorResponse('Janela deve ficar entre 5 e 10080 minutos.');

      const { data, error } = await supabaseAdmin
        .from('admin_monitoring_schedules')
        .insert({
          name,
          recipient_id: recipientId,
          active: asBoolean(body.active, true),
          interval_minutes: intervalMinutes,
          window_minutes: windowMinutes,
          timezone: 'America/Sao_Paulo',
          tenant_ids: sanitizeTenantIds(body.tenantIds),
          include_numbers: asBoolean(body.includeNumbers, true),
          include_recent_messages: asBoolean(body.includeRecentMessages, true),
          next_run_at: new Date(Date.now() + intervalMinutes * 60 * 1000).toISOString(),
          created_by_id: auth.adminId,
        })
        .select('*')
        .single();

      if (error) throw error;
      await audit(auth.adminId, 'admin_monitoring.schedule.create', 'admin_monitoring_schedule', data.id, {
        name,
        recipientId,
        intervalMinutes,
        windowMinutes,
      });
      return NextResponse.json({ ok: true, schedule: data }, { status: 201 });
    }

    if (body.action === 'send_test') {
      const recipientId = String(body.recipientId || '').trim();
      if (!recipientId) return errorResponse('Destinatario e obrigatorio.');
      const result = await invokeDispatcher({ mode: 'recipient_test', recipient_id: recipientId });
      await audit(auth.adminId, 'admin_monitoring.recipient.test', 'admin_monitoring_recipient', recipientId, result);
      return NextResponse.json({ ok: true, result });
    }

    if (body.action === 'run_schedule_now') {
      const scheduleId = String(body.scheduleId || '').trim();
      if (!scheduleId) return errorResponse('Agenda e obrigatoria.');
      const result = await invokeDispatcher({ mode: 'schedule', schedule_id: scheduleId });
      await audit(auth.adminId, 'admin_monitoring.schedule.run_now', 'admin_monitoring_schedule', scheduleId, result);
      return NextResponse.json({ ok: true, result });
    }

    return errorResponse('Acao POST desconhecida.');
  } catch (err: any) {
    console.error('admin/monitoring POST failed', err);
    return errorResponse(err?.message || 'Falha ao processar acao.', 500, 'INTERNAL');
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return errorResponse('JSON invalido.', 400);
  }

  try {
    if (body.type === 'recipient') {
      const id = String(body.id || '').trim();
      if (!id) return errorResponse('ID do destinatario e obrigatorio.');

      const patch: Record<string, unknown> = {};
      if (body.label !== undefined) patch.label = String(body.label || '').trim();
      if (body.whatsapp !== undefined) {
        const whatsapp = normalizeWhatsapp(body.whatsapp);
        if (!E164_RE.test(whatsapp)) return errorResponse('WhatsApp deve estar em E.164. Exemplo: +5517999999999.');
        patch.whatsapp = whatsapp;
      }
      if (body.active !== undefined) patch.active = asBoolean(body.active, true);
      if (body.reportEnabled !== undefined) patch.report_enabled = asBoolean(body.reportEnabled, true);
      if (body.disconnectAlertsEnabled !== undefined) patch.disconnect_alerts_enabled = asBoolean(body.disconnectAlertsEnabled, true);
      if (body.notes !== undefined) patch.notes = String(body.notes || '').trim() || null;

      const { error } = await supabaseAdmin
        .from('admin_monitoring_recipients')
        .update(patch)
        .eq('id', id);

      if (error) throw error;
      await audit(auth.adminId, 'admin_monitoring.recipient.update', 'admin_monitoring_recipient', id, patch);
      return NextResponse.json({ ok: true });
    }

    if (body.type === 'schedule') {
      const id = String(body.id || '').trim();
      if (!id) return errorResponse('ID da agenda e obrigatorio.');

      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) patch.name = String(body.name || '').trim();
      if (body.recipientId !== undefined) patch.recipient_id = String(body.recipientId || '').trim();
      if (body.active !== undefined) patch.active = asBoolean(body.active, true);
      if (body.intervalMinutes !== undefined) {
        const intervalMinutes = asInteger(body.intervalMinutes, 60);
        if (intervalMinutes < 5 || intervalMinutes > 1440) return errorResponse('Intervalo deve ficar entre 5 e 1440 minutos.');
        patch.interval_minutes = intervalMinutes;
      }
      if (body.windowMinutes !== undefined) {
        const windowMinutes = asInteger(body.windowMinutes, 60);
        if (windowMinutes < 5 || windowMinutes > 10080) return errorResponse('Janela deve ficar entre 5 e 10080 minutos.');
        patch.window_minutes = windowMinutes;
      }
      if (body.tenantIds !== undefined) patch.tenant_ids = sanitizeTenantIds(body.tenantIds);
      if (body.includeNumbers !== undefined) patch.include_numbers = asBoolean(body.includeNumbers, true);
      if (body.includeRecentMessages !== undefined) patch.include_recent_messages = asBoolean(body.includeRecentMessages, true);

      const { error } = await supabaseAdmin
        .from('admin_monitoring_schedules')
        .update(patch)
        .eq('id', id);

      if (error) throw error;
      await audit(auth.adminId, 'admin_monitoring.schedule.update', 'admin_monitoring_schedule', id, patch);
      return NextResponse.json({ ok: true });
    }

    return errorResponse('Tipo PATCH desconhecido.');
  } catch (err: any) {
    console.error('admin/monitoring PATCH failed', err);
    return errorResponse(err?.message || 'Falha ao atualizar.', 500, 'INTERNAL');
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const id = searchParams.get('id');
  if (!id) return errorResponse('ID obrigatorio.');

  try {
    if (type === 'recipient') {
      const { error } = await supabaseAdmin.from('admin_monitoring_recipients').delete().eq('id', id);
      if (error) throw error;
      await audit(auth.adminId, 'admin_monitoring.recipient.delete', 'admin_monitoring_recipient', id, {});
      return NextResponse.json({ ok: true });
    }

    if (type === 'schedule') {
      const { error } = await supabaseAdmin.from('admin_monitoring_schedules').delete().eq('id', id);
      if (error) throw error;
      await audit(auth.adminId, 'admin_monitoring.schedule.delete', 'admin_monitoring_schedule', id, {});
      return NextResponse.json({ ok: true });
    }

    return errorResponse('Tipo DELETE desconhecido.');
  } catch (err: any) {
    console.error('admin/monitoring DELETE failed', err);
    return errorResponse(err?.message || 'Falha ao excluir.', 500, 'INTERNAL');
  }
}
