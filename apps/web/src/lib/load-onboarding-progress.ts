import { supabase } from './supabase';
import { apiFetch } from './api-fetch';
import type { OnboardingProgress } from './onboarding-progress';

type ProgressSource = 'whatsapp' | 'leads' | 'icp' | 'context' | 'script' | 'timeout';
export class OnboardingProgressError extends Error {
  constructor(public readonly source: ProgressSource, public readonly code: string) {
    super(`ONBOARDING_${source}_${code}`);
    this.name = 'OnboardingProgressError';
  }
}

export async function loadOnboardingProgress(tenantId: string): Promise<OnboardingProgress> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new OnboardingProgressError('timeout', 'deadline_exceeded')); controller.abort(); }, 10_000);
  });
  const load = async (): Promise<OnboardingProgress> => {
    const [whatsapp, leads, icps, context, scripts] = await Promise.all([
      apiFetch('/api/integrations/whatsapp/status?view=connection', { signal: controller.signal }),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).is('deleted_at', null).abortSignal(controller.signal),
      supabase.from('icps').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).abortSignal(controller.signal),
      supabase.from('tenant_business_context').select('persona_name, business_description, tone_of_voice').eq('tenant_id', tenantId).abortSignal(controller.signal).maybeSingle(),
      supabase.from('scripts').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'ACTIVE').is('archived_at', null).abortSignal(controller.signal),
    ]);
    if (!whatsapp.ok) throw new OnboardingProgressError('whatsapp', `http_${whatsapp.status}`);
    for (const [source, result] of [['leads', leads], ['icp', icps], ['context', context], ['script', scripts]] as const) {
      if (result.error) throw new OnboardingProgressError(source, 'query_failed');
    }
    let connection;
    try { connection = await whatsapp.json(); }
    catch { throw new OnboardingProgressError('whatsapp', 'invalid_response'); }
    if (!['connected', 'disconnected', 'pending_qr'].includes(connection?.status)) {
      const reasons = ['not_configured', 'provider_unavailable', 'invalid_provider_response'];
      throw new OnboardingProgressError('whatsapp', reasons.includes(connection?.reason) ? connection.reason : 'unverified');
    }
    return {
      whatsapp: connection.status === 'connected',
      firstLead: (leads.count ?? 0) > 0,
      icp: (icps.count ?? 0) > 0,
      context: Boolean(context.data?.persona_name?.trim() && context.data?.business_description?.trim() && context.data?.tone_of_voice?.trim()),
      firstScript: (scripts.count ?? 0) > 0,
    };
  };
  try { return await Promise.race([load(), deadline]); }
  finally { clearTimeout(timer!); }
}
