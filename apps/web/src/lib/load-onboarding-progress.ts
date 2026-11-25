import { supabase } from './supabase';
import { apiFetch } from './api-fetch';
import type { OnboardingProgress } from './onboarding-progress';

export async function loadOnboardingProgress(tenantId: string): Promise<OnboardingProgress> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new Error('ONBOARDING_TIMEOUT')); controller.abort(); }, 10_000);
  });
  try {
    const [whatsapp, leads, icps, context, scripts] = await Promise.race([deadline, Promise.all([
      apiFetch('/api/integrations/whatsapp/status?view=connection', { signal: controller.signal }),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).is('deleted_at', null).abortSignal(controller.signal),
      supabase.from('icps').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).abortSignal(controller.signal),
      supabase.from('tenant_business_context').select('persona_name, business_description, tone_of_voice').eq('tenant_id', tenantId).abortSignal(controller.signal).maybeSingle(),
      supabase.from('scripts').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'ACTIVE').is('archived_at', null).abortSignal(controller.signal),
    ])]);
    if (!whatsapp.ok || [leads, icps, context, scripts].some(result => result.error)) throw new Error('PROGRESS_UNAVAILABLE');
    const connection = await whatsapp.json();
    if (!['connected', 'disconnected', 'pending_qr'].includes(connection.status)) throw new Error('CONNECTION_UNVERIFIED');
    return {
      whatsapp: connection.status === 'connected',
      firstLead: (leads.count ?? 0) > 0,
      icp: (icps.count ?? 0) > 0,
      context: Boolean(context.data?.persona_name?.trim() && context.data?.business_description?.trim() && context.data?.tone_of_voice?.trim()),
      firstScript: (scripts.count ?? 0) > 0,
    };
  } finally { clearTimeout(timer!); }
}
