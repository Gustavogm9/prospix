import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, supabaseAdmin } from '../../_lib/supabase-admin';

// GET /api/dashboard/today — Dashboard counters for AppShell
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  const { tenantId } = auth;
  const today = new Date().toISOString().split('T')[0];

  try {
    const [convRes, leadsRes] = await Promise.all([
      supabaseAdmin
        .from('conversations')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'ACTIVE'),
      supabaseAdmin
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .gte('created_at', `${today}T00:00:00.000Z`),
    ]);

    return NextResponse.json({
      data: {
        conversations_ready: convRes.count ?? 0,
        new_leads_today: leadsRes.count ?? 0,
      },
    });
  } catch (err) {
    console.error('Error fetching dashboard counters:', err);
    return NextResponse.json(
      { data: { conversations_ready: 0, new_leads_today: 0 } }
    );
  }
}
