import { NextRequest, NextResponse } from 'next/server';
import { randomUUID, randomBytes } from 'crypto';
import { requireAdmin, supabaseAdmin } from '../../_lib/auth';
import { normalizeOwnerEmail } from '@/lib/onboarding-validation';
import { encryptSecret } from '@/lib/secrets';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateCode(): string {
  const chars = [...randomBytes(8)].map((byte) => ALPHABET[byte % ALPHABET.length]).join('');
  return `PRSPX-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

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

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
  const ownerName = typeof body.ownerName === 'string' ? body.ownerName.trim() : '';
  const ownerEmail = normalizeOwnerEmail(body.ownerEmail);
  const ownerWhatsapp = typeof body.ownerWhatsapp === 'string' ? body.ownerWhatsapp.trim() : '';
  const plan = body.plan ?? 'STANDARD';
  const mrrCents = body.mrrCents;
  const templateId = typeof body.templateId === 'string' && body.templateId ? body.templateId : null;
  const openAiKey = typeof body.openAiKey === 'string' ? body.openAiKey.trim() : '';
  const evolutionInstance = typeof body.evolutionInstance === 'string' ? body.evolutionInstance.trim() : '';

  if (!name || name.length > 160 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80 ||
      !ownerName || ownerName.length > 160 || !ownerEmail || !/^55\d{10,11}$/.test(ownerWhatsapp.replace(/\D/g, '')) ||
      !['STARTER', 'STANDARD', 'PREMIUM'].includes(String(plan)) || !Number.isSafeInteger(mrrCents) || mrrCents < 0 ||
      openAiKey.length > 8192 || (evolutionInstance !== '' && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(evolutionInstance))) {
    return NextResponse.json({ error: 'VALIDATION', message: 'Revise nome, identificador, plano, mensalidade, e-mail e WhatsApp do responsável.' }, { status: 400 });
  }

  let createdTenantId: string | null = null;
  try {
    // Check slug collision
    const { data: collision } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    if (collision) {
      return NextResponse.json({ error: 'CONFLICT', message: 'Identificador já cadastrado.' }, { status: 409 });
    }

    const { data: existingOwner, error: ownerCollisionError } = await supabaseAdmin.from('users').select('id').ilike('email', ownerEmail).maybeSingle();
    if (ownerCollisionError) throw ownerCollisionError;
    if (existingOwner) return NextResponse.json({ error: 'CONFLICT', message: 'Este e-mail já pertence a outra conta.' }, { status: 409 });

    let selectedTemplate: Record<string, any> | null = null;
    if (templateId) {
      const { data, error } = await supabaseAdmin.from('script_templates').select('*').eq('id', templateId).eq('active', true).maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: 'VALIDATION', message: 'O template selecionado não está disponível.' }, { status: 400 });
      selectedTemplate = data;
    }

    // Create tenant
    createdTenantId = randomUUID();
    const { data: newTenant, error: createErr } = await supabaseAdmin
      .from('tenants')
      .insert({
        id: createdTenantId,
        name,
        slug,
        segment: 'insurance_other',
        status: 'ONBOARDING',
        plan,
        mrr_cents: mrrCents,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (createErr) throw createErr;

    // Create tenant secret
    const { error: secretsError } = await supabaseAdmin.from('tenant_secrets').insert({
      tenant_id: newTenant.id,
      evolution_instance_name: evolutionInstance || `tenant_${slug.replace(/[^a-zA-Z0-9]/g, '')}`,
      ...(openAiKey ? { openai_api_key_encrypted: encryptSecret(openAiKey), ai_provider: 'TENANT_OWN' as const } : {}),
      updated_at: new Date().toISOString(),
    });
    if (secretsError) throw secretsError;

    // Create tenant AI config
    const { error: aiError } = await supabaseAdmin.from('tenant_ai_configs').insert({
      tenant_id: newTenant.id,
      system_model: 'gpt-4o-mini',
      classifier_model: 'gpt-4o-mini',
      guardrail_model: 'gpt-4o-mini',
      updated_at: new Date().toISOString(),
    });
    if (aiError) throw aiError;

    // Pending owner profile; the verified invite will bind it to the Auth identity.
    const { error: ownerError } = await supabaseAdmin.from('users').insert({
        id: randomUUID(),
        tenant_id: newTenant.id,
        role: 'OWNER',
        name: ownerName,
        email: ownerEmail,
        whatsapp: ownerWhatsapp,
        updated_at: new Date().toISOString(),
    });
    if (ownerError) throw ownerError;

    if (selectedTemplate) {
      const flow = typeof selectedTemplate.flow_template === 'string'
        ? JSON.parse(selectedTemplate.flow_template)
        : selectedTemplate.flow_template;
      const { error: cloneError } = await supabaseAdmin.from('scripts').insert({
        id: randomUUID(), tenant_id: newTenant.id, cloned_from_template_id: selectedTemplate.id,
        name: selectedTemplate.name, category: selectedTemplate.category,
        target_profession: selectedTemplate.target_profession, flow,
        base_message: selectedTemplate.base_message_template, variables: selectedTemplate.variables,
        status: 'DRAFT', updated_at: new Date().toISOString(),
      });
      if (cloneError) throw cloneError;
    }

    let code = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateCode();
      const { data: collision, error } = await supabaseAdmin.from('tenant_invitations').select('id').eq('code', candidate).maybeSingle();
      if (error) throw error;
      if (!collision) { code = candidate; break; }
    }
    if (!code) throw new Error('Não foi possível gerar um código de convite único.');
    const { error: inviteError } = await supabaseAdmin.from('tenant_invitations').insert({
      id: randomUUID(), code, tenant_id: newTenant.id, role: 'OWNER',
      created_by_id: adminId,
      expires_at: new Date(Date.now() + 14 * 86400_000).toISOString(),
      notes: 'Chave de onboarding gerada no cadastro do tenant',
    });
    if (inviteError) throw inviteError;

    // Audit log
    const { error: auditError } = await supabaseAdmin.from('audit_log').insert({
      user_id: adminId,
      action: 'tenant.create',
      target_type: 'tenant',
      target_id: newTenant.id,
      payload: { slug, plan, templateId },
    });
    if (auditError) console.error('admin/tenants → audit insert failed', { tenantId: newTenant.id, code: auditError.code });

    return NextResponse.json({ ...newTenant, invitationCode: code }, { status: 201 });
  } catch (err) {
    console.error('admin/tenants → POST create failed', err);
    if (createdTenantId) {
      // Only rows belonging to this new ID are touched. Never remove an existing tenant.
      await supabaseAdmin.from('tenant_invitations').delete().eq('tenant_id', createdTenantId);
      await supabaseAdmin.from('scripts').delete().eq('tenant_id', createdTenantId);
      await supabaseAdmin.from('users').delete().eq('tenant_id', createdTenantId);
      await supabaseAdmin.from('tenant_ai_configs').delete().eq('tenant_id', createdTenantId);
      await supabaseAdmin.from('tenant_secrets').delete().eq('tenant_id', createdTenantId);
      const { error: cleanupError } = await supabaseAdmin.from('tenants').delete().eq('id', createdTenantId);
      if (cleanupError) console.error('admin/tenants → cleanup failed', { tenantId: createdTenantId, code: cleanupError.code });
    }
    return NextResponse.json({ error: 'INTERNAL', message: 'Não foi possível concluir o cadastro. Verifique se o tenant apareceu antes de tentar novamente.' }, { status: 500 });
  }
}
