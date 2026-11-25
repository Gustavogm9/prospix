import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '../../_lib/supabase-admin';
import { onboardingClientSchema } from '../../../../lib/onboarding-client';
import { createManualLead } from '../../../../lib/manual-lead';
import type { Database } from '../../../../lib/database.types';

export async function POST(request: NextRequest) {
  const idCorrelacao = crypto.randomUUID();
  const fail = (status: number, codigo: string, mensagem: string, campos?: Record<string, string>) => NextResponse.json({ erro: { codigo, mensagem, campos }, idCorrelacao }, { status, headers: { 'Cache-Control': 'no-store' } });
  try {
    const auth = await authenticateRequest(request);
    if ('error' in auth) return auth.error;
    if (!auth.tenantId || !['OWNER', 'ASSISTANT'].includes(auth.role)) return fail(403, 'SEM_PERMISSAO', 'Use uma conta de cliente para cadastrar contatos.');
    const key = z.string().uuid().safeParse(request.headers.get('Idempotency-Key'));
    const parsed = onboardingClientSchema.safeParse(await request.json().catch(() => null));
    if (!key.success || !parsed.success) return fail(400, 'CAMPOS_INVALIDOS', 'Confira os campos do cadastro.', parsed.success ? undefined : Object.fromEntries(parsed.error.issues.map(issue => [issue.path[0], issue.message])));
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return fail(503, 'INDISPONIVEL', 'O cadastro está temporariamente indisponível.');
    // Every write uses the caller's JWT; no elevated client writes business data.
    const client = createClient<Database>(url, anonKey, {
      global: { headers: { Authorization: request.headers.get('authorization')! } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const result = await createManualLead(client, auth.tenantId, {
      name: parsed.data.name, whatsapp: parsed.data.whatsapp, profession: 'OTHER',
      email: parsed.data.email || undefined, address: parsed.data.city ? { city: parsed.data.city } : {},
    }, key.data);
    if (result.error || !result.data?.id) return fail(result.error?.code === 'CONFLICT' || result.error?.code === '23505' ? 409 : 503, 'CADASTRO_NAO_CONFIRMADO', 'Não foi possível confirmar o cadastro. Confira Meus Leads antes de tentar novamente.');
    return NextResponse.json({ id: result.data.id }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return fail(503, 'INDISPONIVEL', 'Não foi possível confirmar o cadastro. Confira Meus Leads antes de tentar novamente.');
  }
}
