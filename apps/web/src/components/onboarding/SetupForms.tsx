'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { icpsQueries, scriptsQueries } from '@/lib/queries';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth-store';
import { useOnboardingProgress } from './OnboardingProgressContext';

const inputClass = 'min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text focus:outline-primary disabled:opacity-60';
const buttonClass = 'inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto';
function useAlive() {
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return alive;
}
function ErrorNotice({ error }: { error: string }) { return error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p> : null; }

export function IcpStep() {
  const tenantId = useAuthStore(state => state.tenantId)!;
  const { refresh } = useOnboardingProgress();
  const [name, setName] = useState('');
  const [areas, setAreas] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const saved = useRef(false);
  const alive = useAlive();
  return <form className="space-y-5" onSubmit={async event => {
    event.preventDefault(); if (saving.current) return;
    if (name.trim().length < 3) { setError('Informe um nome para seu perfil de cliente ideal.'); document.getElementById('icp-name')?.focus(); return; }
    saving.current = true; setBusy(true); setError('');
    try {
      if (!saved.current) {
        const result = await icpsQueries.create(tenantId, { name: name.trim(), highValueAreas: areas.split(',').map(value => value.trim()).filter(Boolean) });
        if (!alive.current) return;
        if (result.error || !result.data?.id) throw new Error('SAVE_FAILED');
        saved.current = true;
      }
      await refresh();
    } catch { if (alive.current) setError('Não foi possível confirmar o perfil. Seus campos foram preservados. Tente novamente.'); }
    finally { saving.current = false; if (alive.current) setBusy(false); }
  }}>
    <div><h2 className="text-2xl font-bold text-text">Defina seu cliente ideal</h2><p className="mt-3 text-sm leading-relaxed text-text-secondary">Dê um nome ao público que você quer atender. Os critérios de qualificação podem ser ajustados depois.</p></div>
    <div><label htmlFor="icp-name" className="mb-2 block text-sm font-medium text-text">Perfil de cliente ideal</label><input id="icp-name" required minLength={3} maxLength={120} placeholder="Ex.: Empresas de serviços da minha região" value={name} disabled={busy || saved.current} onChange={event => setName(event.target.value)} className={inputClass} /></div>
    <div><label htmlFor="icp-areas" className="mb-2 block text-sm font-medium text-text">Bairros ou regiões prioritárias (opcional)</label><input id="icp-areas" maxLength={500} placeholder="Separe por vírgula" value={areas} disabled={busy || saved.current} onChange={event => setAreas(event.target.value)} className={inputClass} /></div>
    <ErrorNotice error={error} /><button type="submit" disabled={busy} className={buttonClass}>{busy ? 'Conferindo…' : saved.current ? 'Conferir perfil salvo' : 'Salvar perfil e continuar'}</button>
  </form>;
}

type BusinessFields = { persona_name: string; business_description: string; tone_of_voice: string };
export function BusinessStep() {
  const tenantId = useAuthStore(state => state.tenantId)!;
  const { refresh } = useOnboardingProgress();
  const [form, setForm] = useState<BusinessFields>({ persona_name: '', business_description: '', tone_of_voice: '' });
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const alive = useRef(false);
  const load = useCallback(async () => {
    setLoading(true); setLoadFailed(false);
    try {
      const { data, error: failure } = await supabase.from('tenant_business_context').select('persona_name, business_description, tone_of_voice').eq('tenant_id', tenantId).abortSignal(AbortSignal.timeout(10_000)).maybeSingle();
      if (failure) throw failure;
      if (alive.current && data) setForm({ persona_name: data.persona_name || '', business_description: data.business_description || '', tone_of_voice: data.tone_of_voice || '' });
    } catch { if (alive.current) setLoadFailed(true); }
    finally { if (alive.current) setLoading(false); }
  }, [tenantId]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);
  return <form className="space-y-5" onSubmit={async event => {
    event.preventDefault(); if (saving.current || loading || loadFailed) return;
    const missing = (Object.keys(form) as (keyof BusinessFields)[]).find(key => !form[key].trim());
    if (missing) { setError('Preencha os dados do negócio antes de continuar.'); document.getElementById(missing)?.focus(); return; }
    saving.current = true; setBusy(true); setError('');
    try {
      const { data, error: failure } = await supabase.from('tenant_business_context').upsert({ tenant_id: tenantId, persona_name: form.persona_name.trim(), business_description: form.business_description.trim(), tone_of_voice: form.tone_of_voice.trim(), updated_at: new Date().toISOString() }, { onConflict: 'tenant_id' }).select('tenant_id').single();
      if (!alive.current) return;
      if (failure || data?.tenant_id !== tenantId) throw new Error('SAVE_FAILED');
      await refresh();
    } catch { if (alive.current) setError('Não foi possível confirmar os dados do negócio. Tente novamente.'); }
    finally { saving.current = false; if (alive.current) setBusy(false); }
  }}>
    <div><h2 className="text-2xl font-bold text-text">Apresente seu negócio</h2><p className="mt-3 text-sm leading-relaxed text-text-secondary">Conte o que você oferece e como sua assistente deve conversar com os clientes.</p></div>
    {loading && <p role="status" className="text-sm text-text-secondary">Carregando os dados já salvos…</p>}
    {loadFailed && <div role="alert" className="text-sm text-red-700">Não foi possível carregar seu perfil. <button type="button" onClick={() => void load()} className="min-h-11 underline">Tentar novamente</button></div>}
    {(['persona_name', 'business_description', 'tone_of_voice'] as const).map(key => <div key={key}><label htmlFor={key} className="mb-2 block text-sm font-medium text-text">{{ persona_name: 'Nome da assistente', business_description: 'O que sua empresa oferece?', tone_of_voice: 'Como a assistente deve conversar?' }[key]}</label>{key === 'persona_name' ? <input id={key} required maxLength={100} disabled={busy || loading || loadFailed} value={form[key]} onChange={event => setForm(previous => ({ ...previous, [key]: event.target.value }))} className={inputClass} /> : <textarea id={key} required maxLength={5000} rows={key === 'business_description' ? 4 : 3} disabled={busy || loading || loadFailed} value={form[key]} onChange={event => setForm(previous => ({ ...previous, [key]: event.target.value }))} className={inputClass} />}</div>)}
    <ErrorNotice error={error} /><button type="submit" disabled={busy || loading || loadFailed} className={buttonClass}>{busy ? 'Salvando…' : 'Salvar negócio e continuar'}</button>
  </form>;
}

export function ScriptStep() {
  const tenantId = useAuthStore(state => state.tenantId)!;
  const { refresh } = useOnboardingProgress();
  const [name, setName] = useState(''); const [message, setMessage] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const saving = useRef(false); const scriptId = useRef<string | null>(null);
  const alive = useAlive();
  return <form className="space-y-5" onSubmit={async event => {
    event.preventDefault(); if (saving.current || !reviewed) return;
    if (name.trim().length < 3 || message.trim().length < 10) { setError('Preencha o nome e uma mensagem de abordagem com pelo menos 10 caracteres.'); return; }
    saving.current = true; setBusy(true); setError('');
    try {
      if (!scriptId.current) {
        const result = await scriptsQueries.create(tenantId, { name: name.trim(), category: 'APPROACH', baseMessage: message.trim() });
        if (!alive.current) return;
        if (result.error || !result.data?.id) throw new Error('SAVE_FAILED');
        scriptId.current = result.data.id;
      }
      const result = await scriptsQueries.update(tenantId, scriptId.current, { name: name.trim(), baseMessage: message.trim(), status: 'ACTIVE' });
      if (!alive.current) return;
      if (result.error || result.data?.status !== 'ACTIVE' || result.data?.base_message !== message.trim()) throw new Error('ACTIVATION_FAILED');
      await refresh();
    } catch { if (alive.current) setError('Não foi possível confirmar a ativação. Seu texto foi preservado. Tente novamente.'); }
    finally { saving.current = false; if (alive.current) setBusy(false); }
  }}>
    <div><h2 className="text-2xl font-bold text-text">Prepare seu primeiro roteiro</h2><p className="mt-3 text-sm leading-relaxed text-text-secondary">Escreva sua mensagem inicial e revise antes de ativar. Você poderá detalhar o roteiro depois.</p></div>
    <div><label htmlFor="script-name" className="mb-2 block text-sm font-medium text-text">Nome do roteiro</label><input id="script-name" required minLength={3} maxLength={120} value={name} disabled={busy} onChange={event => setName(event.target.value)} className={inputClass} /></div>
    <div><label htmlFor="script-message" className="mb-2 block text-sm font-medium text-text">Mensagem de abordagem</label><textarea id="script-message" required minLength={10} maxLength={5000} rows={5} value={message} disabled={busy} onChange={event => setMessage(event.target.value)} className={inputClass} /></div>
    <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-relaxed text-text-secondary"><input type="checkbox" required checked={reviewed} disabled={busy} onChange={event => setReviewed(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-primary" />Revisei a mensagem e quero ativar este roteiro. Isso não ativa campanhas nem envia mensagens.</label>
    <ErrorNotice error={error} /><button type="submit" disabled={busy || !reviewed} className={buttonClass}>{busy ? 'Conferindo ativação…' : 'Ativar roteiro e concluir'}</button>
  </form>;
}
