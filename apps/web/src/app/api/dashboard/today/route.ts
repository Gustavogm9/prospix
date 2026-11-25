import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, supabaseAdmin } from '../../_lib/supabase-admin';
import { saoPauloDayRange } from '../../../../lib/sao-paulo-time';

// GET /api/dashboard/today — Dashboard counters for AppShell
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  const { tenantId } = auth;
  const { start, end } = saoPauloDayRange();

  try {
    const [convRes, leadsRes] = await Promise.all([
      supabaseAdmin
        .from('conversations')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'ACTIVE')
        .is('removed_at', null),
      supabaseAdmin
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .gte('created_at', start)
        .lt('created_at', end),
    ]);

    if (convRes.error || leadsRes.error) {
      return NextResponse.json({ error: 'DATA_UNAVAILABLE', message: 'Não foi possível consultar os indicadores.' }, { status: 503 });
    }

    return NextResponse.json({
      data: {
        conversations_ready: convRes.count ?? 0,
        new_leads_today: leadsRes.count ?? 0,
      },
    });
  } catch (err) {
    console.error('Error fetching dashboard counters:', err);
    return NextResponse.json(
      { error: 'DATA_UNAVAILABLE', message: 'Não foi possível consultar os indicadores.' }, { status: 503 },
    );
  }
}
