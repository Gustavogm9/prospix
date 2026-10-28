import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireAdmin, supabaseAdmin } from '../../_lib/auth';

const SCRIPT_CATEGORIES = new Set(['APPROACH', 'OBJECTION', 'EDUCATION', 'CLOSING', 'FOLLOW_UP', 'REFERRAL', 'REACTIVATION']);

// =========================================================================
// GET /api/admin/templates — List active templates
// =========================================================================
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { data: templates, error } = await supabaseAdmin
      .from('script_templates')
      .select('*')
      .eq('active', true)
      .order('popularity', { ascending: false });
    if (error) throw error;
    return NextResponse.json({ data: templates });
  } catch (err) {
    console.error('admin/templates → GET failed', err);
    return NextResponse.json({ error: 'INTERNAL', message: 'Falha ao listar templates.' }, { status: 500 });
  }
}

// =========================================================================
// POST /api/admin/templates — Create template
// =========================================================================
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'VALIDATION', message: 'Invalid JSON body.' }, { status: 400 });
  }

  const { name, segment, category, targetProfession, flowTemplate, baseMessageTemplate, variables = [], description } = body;

  if (typeof name !== 'string' || !name.trim() || typeof segment !== 'string' || !segment.trim() || !SCRIPT_CATEGORIES.has(category) || !Array.isArray(flowTemplate)) {
    return NextResponse.json({ error: 'VALIDATION', message: 'Nome, segmento, categoria e nós do roteiro são obrigatórios.' }, { status: 400 });
  }

  try {
    const { data: template, error } = await supabaseAdmin
      .from('script_templates')
      .insert({
        id: randomUUID(),
        name: name.trim(),
        segment: segment.trim(),
        category,
        target_profession: targetProfession,
        flow_template: flowTemplate,
        base_message_template: baseMessageTemplate,
        variables,
        description,
        active: true,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ data: template }, { status: 201 });
  } catch (err) {
    console.error('admin/templates → POST failed', err);
    return NextResponse.json({ error: 'INTERNAL', message: 'Falha ao criar template.' }, { status: 500 });
  }
}
