import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, supabaseAdmin } from '../../../_lib/auth';

// =========================================================================
// PATCH /api/admin/templates/[id] — Update template
// =========================================================================
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'VALIDATION', message: 'Invalid JSON body.' }, { status: 400 });
  }

  try {
    const { data: template } = await supabaseAdmin.from('script_templates').select('id').eq('id', id).single();
    if (!template) {
      return NextResponse.json({ error: 'RESOURCE_NOT_FOUND', message: 'Template not found' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.segment !== undefined) updateData.segment = body.segment;
    if (body.category !== undefined) updateData.category = body.category;
    if (body.flowTemplate !== undefined) updateData.flow_template = JSON.stringify(body.flowTemplate);
    if (body.baseMessageTemplate !== undefined) updateData.base_message_template = body.baseMessageTemplate;
    if (body.variables !== undefined) updateData.variables = body.variables;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.active !== undefined) updateData.active = body.active;
    updateData.updated_at = new Date().toISOString();

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('script_templates')
      .update(updateData as any)
      .eq('id', id)
      .select()
      .single();
    if (updateErr) throw updateErr;

    return NextResponse.json({ data: updated });
  } catch (err) {
    console.error('admin/templates/[id] → PATCH failed', err);
    return NextResponse.json({ error: 'INTERNAL', message: 'Falha ao atualizar template.' }, { status: 500 });
  }
}

// =========================================================================
// DELETE /api/admin/templates/[id] — Soft delete (deactivate) template
// =========================================================================
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  try {
    const { data: template } = await supabaseAdmin.from('script_templates').select('id').eq('id', id).single();
    if (!template) {
      return NextResponse.json({ error: 'RESOURCE_NOT_FOUND', message: 'Template not found' }, { status: 404 });
    }

    await supabaseAdmin.from('script_templates').update({ active: false }).eq('id', id);

    return NextResponse.json({ success: true, message: 'Template deactivated successfully' });
  } catch (err) {
    console.error('admin/templates/[id] → DELETE failed', err);
    return NextResponse.json({ error: 'INTERNAL', message: 'Falha ao desativar template.' }, { status: 500 });
  }
}
