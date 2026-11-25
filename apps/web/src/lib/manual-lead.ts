import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
type Profession = Database['public']['Enums']['Profession'];

export async function createManualLead(client: SupabaseClient<Database>, tenantId: string, leadData: {
    name?: string;
    profession?: Profession;
    whatsapp: string;
    email?: string;
    address?: { city?: string; neighborhood?: string; street?: string };
    campaignId?: string;
    metadata?: Record<string, unknown>;
  }, operationId?: string) {
    if (operationId) {
      const prior = await client.from('leads').select('*').eq('tenant_id', tenantId).eq('id', operationId).maybeSingle();
      if (prior.error) return { data: null, error: { message: prior.error.message, code: prior.error.code } };
      if (prior.data) {
        if (prior.data.whatsapp !== leadData.whatsapp || prior.data.name !== leadData.name || (prior.data.email || '') !== (leadData.email || '') || JSON.stringify(prior.data.address) !== JSON.stringify(leadData.address)) {
          return { data: null, error: { code: 'CONFLICT', message: 'Use uma nova operação para outro cadastro.' } };
        }
        return { data: prior.data, error: null };
      }
    }
    const sanitized = leadData.whatsapp.replace(/[^0-9]/g, '');
    const finalWhatsapp = sanitized.startsWith('55') ? sanitized : `55${sanitized}`;

    // Uniqueness check
    const { data: existing, error: findError } = await client
      .from('leads')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('whatsapp', finalWhatsapp)
      .maybeSingle();

    if (findError) return { data: null, error: { message: findError.message, code: findError.code } };
    if (existing) {
      return { data: null, error: { message: 'A lead with this WhatsApp number already exists.', code: 'CONFLICT' } };
    }

    const now = new Date().toISOString();
    const { data, error } = await client
      .from('leads')
      .insert({
        id: operationId || crypto.randomUUID(),
        tenant_id: tenantId,
        campaign_id: leadData.campaignId,
        source: 'MANUAL' as const,
        name: leadData.name,
        profession: leadData.profession,
        whatsapp: finalWhatsapp,
        email: leadData.email,
        address: leadData.address as any,
        status: 'CAPTURED' as const,
        metadata: leadData.metadata as any,
        updated_at: now,
      })
      .select()
      .single();

    if (error) return { data: null, error: { message: error.message, code: error.code } };

    // Record captured event
    await client.from('lead_events').insert({
      tenant_id: tenantId,
      lead_id: data.id,
      event_type: 'captured',
      payload: { source: 'manual' } as any,
    });

    return { data, error: null };
  }
