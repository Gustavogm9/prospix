import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireAdmin, supabaseAdmin } from '../../_lib/auth';

// =========================================================================
// POST /api/admin/tenants — Create a new tenant (onboarding wizard)
// =========================================================================
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const adminId = auth.userId;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'VALIDATION', message: 'Invalid JSON body.' }, { status: 400 });
  }

  const { name, slug, segment = 'insurance_other', plan = 'STANDARD', mrrCents = 15000, ownerName, ownerEmail, ownerWhatsapp } = body;

  if (!name || !slug) {
    return NextResponse.json({ error: 'VALIDATION', message: 'name e slug são obrigatórios.' }, { status: 400 });
  }

  try {
    // Check slug collision
    const { data: collision } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    if (collision) {
      return NextResponse.json({ error: 'Conflict', message: 'Tenant slug already exists' }, { status: 409 });
    }

    // Create tenant
    const { data: newTenant, error: createErr } = await supabaseAdmin
      .from('tenants')
      .insert({
        id: randomUUID(),
        name,
        slug,
        segment,
        status: 'ONBOARDING',
        plan,
        mrr_cents: Number(mrrCents),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (createErr) throw createErr;

    // Create tenant secret
    await supabaseAdmin.from('tenant_secrets').insert({
      tenant_id: newTenant.id,
      evolution_instance_name: `tenant_${slug.replace(/[^a-zA-Z0-9]/g, '')}`,
      updated_at: new Date().toISOString(),
    });

    // Create tenant AI config
    await supabaseAdmin.from('tenant_ai_configs').insert({
      tenant_id: newTenant.id,
      system_model: 'gpt-4o-mini',
      classifier_model: 'gpt-4o-mini',
      guardrail_model: 'gpt-4o-mini',
      updated_at: new Date().toISOString(),
    });

    // Create owner user if provided
    if (ownerEmail && ownerName && ownerWhatsapp) {
      await supabaseAdmin.from('users').insert({
        id: randomUUID(),
        tenant_id: newTenant.id,
        role: 'OWNER',
        name: ownerName,
        email: ownerEmail,
        whatsapp: ownerWhatsapp,
        updated_at: new Date().toISOString(),
      });
    }

    // Audit log
    await supabaseAdmin.from('audit_log').insert({
      user_id: adminId,
      action: 'tenant.create',
      target_type: 'tenant',
      target_id: newTenant.id,
      payload: { slug, plan },
    });

    return NextResponse.json(newTenant, { status: 201 });
  } catch (err) {
    console.error('admin/tenants → POST create failed', err);
    return NextResponse.json({ error: 'INTERNAL', message: 'Falha ao criar tenant.' }, { status: 500 });
  }
}
