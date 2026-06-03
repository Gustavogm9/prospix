import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../_lib/supabase-admin';

/**
 * POST /api/notifications/daily-summary
 *
 * Generates a daily summary notification for all active tenants.
 * Called by a cron job at 18h BRT daily.
 *
 * Secured by a shared secret (CRON_SECRET) to prevent unauthorized calls.
 */
export async function POST(request: NextRequest) {
  // Validate cron secret
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET || 'prospix-cron-2025';
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  try {
    // Get all active tenants
    const { data: tenants, error: tenantErr } = await supabaseAdmin
      .from('tenants')
      .select('id, name')
      .eq('status', 'ACTIVE')
      .is('deleted_at', null);

    if (tenantErr || !tenants) {
      console.error('Error fetching tenants:', tenantErr);
      return NextResponse.json({ error: 'Failed to fetch tenants' }, { status: 500 });
    }

    let summariesCreated = 0;

    for (const tenant of tenants) {
      // Gather today's stats for this tenant
      const [leadsRes, meetingsRes, conversationsRes, messagesRes] = await Promise.all([
        // New leads captured today
        supabaseAdmin
          .from('leads')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant.id)
          .is('deleted_at', null)
          .gte('created_at', todayISO),

        // Meetings scheduled today
        supabaseAdmin
          .from('meetings')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant.id)
          .gte('created_at', todayISO),

        // Active conversations today
        supabaseAdmin
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant.id)
          .gte('last_message_at', todayISO),

        // Inbound messages today
        supabaseAdmin
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant.id)
          .eq('direction', 'INBOUND')
          .gte('created_at', todayISO),
      ]);

      const newLeads = leadsRes.count ?? 0;
      const newMeetings = meetingsRes.count ?? 0;
      const activeConvos = conversationsRes.count ?? 0;
      const inboundMsgs = messagesRes.count ?? 0;

      // Skip tenants with zero activity
      if (newLeads === 0 && newMeetings === 0 && activeConvos === 0 && inboundMsgs === 0) {
        continue;
      }

      // Build summary text
      const parts: string[] = [];
      if (newLeads > 0) parts.push(`${newLeads} novo${newLeads > 1 ? 's' : ''} lead${newLeads > 1 ? 's' : ''}`);
      if (newMeetings > 0) parts.push(`${newMeetings} reuniã${newMeetings > 1 ? 'es' : 'o'} agendada${newMeetings > 1 ? 's' : ''}`);
      if (activeConvos > 0) parts.push(`${activeConvos} conversa${activeConvos > 1 ? 's' : ''} ativa${activeConvos > 1 ? 's' : ''}`);
      if (inboundMsgs > 0) parts.push(`${inboundMsgs} resposta${inboundMsgs > 1 ? 's' : ''} de lead${inboundMsgs > 1 ? 's' : ''}`);

      const body = parts.join(' · ');

      const dayFormatted = today.toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'America/Sao_Paulo',
      });

      // Get all users for this tenant who haven't disabled daily_summary
      const { data: users } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('tenant_id', tenant.id)
        .is('deleted_at', null);

      if (!users || users.length === 0) continue;

      // Check preferences — exclude users who explicitly disabled
      const { data: disabledPrefs } = await supabaseAdmin
        .from('notification_preferences')
        .select('user_id')
        .eq('event_type', 'daily_summary')
        .eq('enabled', false)
        .in('user_id', users.map((u) => u.id));

      const disabledUserIds = new Set((disabledPrefs || []).map((p) => p.user_id));

      // Create notifications
      const notifications = users
        .filter((u) => !disabledUserIds.has(u.id))
        .map((u) => ({
          id: crypto.randomUUID(),
          tenant_id: tenant.id,
          user_id: u.id,
          type: 'daily_summary',
          title: `📊 Resumo do dia — ${dayFormatted}`,
          body,
          link: '/',
          data: { newLeads, newMeetings, activeConvos, inboundMsgs },
          created_at: new Date().toISOString(),
        }));

      if (notifications.length > 0) {
        const { error: insertErr } = await supabaseAdmin
          .from('notifications')
          .insert(notifications);

        if (insertErr) {
          console.error(`Error inserting summary for tenant ${tenant.id}:`, insertErr);
        } else {
          summariesCreated += notifications.length;
        }
      }
    }

    return NextResponse.json({
      success: true,
      summariesCreated,
      tenantsProcessed: tenants.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Daily summary error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
