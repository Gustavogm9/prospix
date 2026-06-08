import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/discover
 * Proxy para a Edge Function discover-leads no Supabase.
 * Chamado pela tela de Fontes quando o corretor clica em "Executar Busca".
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tenant_id, campaign_id, source_type, config } = body;

    if (!tenant_id || !source_type) {
      return NextResponse.json(
        { ok: false, error: 'tenant_id e source_type são obrigatórios' },
        { status: 400 }
      );
    }

    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return NextResponse.json(
        { ok: false, error: 'Supabase não configurado' },
        { status: 500 }
      );
    }

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/discover-leads`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({
          tenant_id,
          campaign_id: campaign_id || null,
          source_type,
          config: config || {},
        }),
      }
    );

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[API /discover] Error:', error);
    return NextResponse.json(
      { ok: false, error: error.message || 'Erro interno' },
      { status: 500 }
    );
  }
}
