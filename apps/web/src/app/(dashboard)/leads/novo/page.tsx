'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { onboardingClientSchema as schema } from '@/lib/onboarding-client';
import { apiFetch } from '@/lib/api-fetch';
import { useAuthStore } from '@/store/auth-store';

export default function NewLeadPage() {
  const { tenantId, user } = useAuthStore();
  if (!tenantId || !user) return null;
  return <NewLeadForm key={`${tenantId}:${user.id}`} tenantId={tenantId} />;
}

function NewLeadForm({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const saving = useRef(false);
  const operation = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ name: '', whatsapp: '', email: '', city: '' });
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!tenantId || saving.current) return;
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      setFields(Object.fromEntries(parsed.error.issues.map(issue => [issue.path[0], issue.message])));
      document.getElementById(String(parsed.error.issues[0]?.path[0]))?.focus();
      return;
    }
    saving.current = true; setBusy(true); setError(''); setFields({});
    const scope = tenantId;
    try {
      operation.current ??= crypto.randomUUID();
      const response = await apiFetch('/api/onboarding/client', { method: 'POST', headers: { 'Idempotency-Key': operation.current }, body: JSON.stringify(form) });
      const result = await response.json();
      if (useAuthStore.getState().tenantId !== scope) return;
      if (!response.ok || !result.id) {
        if (result.erro?.campos) setFields(result.erro.campos);
        throw new Error(result.erro?.mensagem || 'Não foi possível confirmar o cadastro. Confira Meus Leads antes de tentar novamente.');
      }
      router.push('/onboarding');
    } catch (cause) {
      if (useAuthStore.getState().tenantId === scope) setError(cause instanceof Error ? cause.message : 'Não foi possível confirmar o cadastro.');
    } finally { saving.current = false; setBusy(false); }
  };
  return <section aria-labelledby="onboarding-client-title" className="mx-auto max-w-xl rounded-2xl border border-border bg-white p-5 shadow-sm sm:p-7">
    <Link href="/onboarding" className="mb-5 inline-flex min-h-11 items-center text-sm text-primary underline">Voltar aos primeiros passos</Link>
    <h1 id="onboarding-client-title" className="text-xl font-bold text-text">Cadastre seu primeiro cliente</h1>
    <p className="mt-2 text-sm text-text-secondary">Ele ficará em Meus Leads. Nenhuma mensagem será enviada ao salvar.</p>
    <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
      {(['name', 'whatsapp', 'email', 'city'] as const).map(key => <div key={key}>
        <label htmlFor={key} className="mb-2 block text-sm font-medium text-text">{{ name: 'Nome do cliente', whatsapp: 'WhatsApp com DDD', email: 'E-mail (opcional)', city: 'Cidade (opcional)' }[key]}</label>
        <input id={key} required={key === 'name' || key === 'whatsapp'} type={key === 'email' ? 'email' : key === 'whatsapp' ? 'tel' : 'text'} autoComplete={{ name: 'name', whatsapp: 'tel', email: 'email', city: 'address-level2' }[key]}
          disabled={busy} value={form[key]} onChange={event => { operation.current = null; setForm(previous => ({ ...previous, [key]: event.target.value })); }} aria-invalid={Boolean(fields[key])} aria-describedby={fields[key] ? `${key}-error` : undefined}
          className="min-h-11 w-full rounded-lg border border-border bg-white px-3 text-sm text-text focus:outline-primary" />
        {fields[key] && <p id={`${key}-error`} role="alert" className="mt-1 text-sm text-red-700">{fields[key]}</p>}
      </div>)}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <button disabled={busy || !tenantId} type="submit" className="min-h-11 w-full rounded-lg bg-primary px-4 font-semibold text-white disabled:opacity-60">{busy ? 'Salvando…' : 'Salvar cliente e continuar'}</button>
    </form>
  </section>;
}
