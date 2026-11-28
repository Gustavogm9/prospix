'use client';
import { useEffect, useRef, useState } from 'react';
import { Loader2, QrCode, RefreshCw, Smartphone } from 'lucide-react';
import { requestOnboardingQr } from '@/lib/onboarding-whatsapp';
import { useAuthStore } from '@/store/auth-store';
import { useOnboardingProgress } from './OnboardingProgressContext';

export function WhatsAppStep() {
  const role = useAuthStore(state => state.user?.role);
  const { loading, refresh } = useOnboardingProgress();
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expiresAt, setExpiresAt] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const sending = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setRemaining(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
    tick(); const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  const connect = async () => {
    if (sending.current || role !== 'OWNER') return;
    sending.current = true; setBusy(true); setError(''); setQr(null);
    try {
      const value = await requestOnboardingQr();
      if (!alive.current) return;
      if (value === null) { await refresh(); return; }
      setQr(value);
      setExpiresAt(Date.now() + 40_000);
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error && cause.message === 'QR_TIMEOUT'
        ? 'A geração do QR Code demorou mais que o esperado. Tente novamente.'
        : 'Não foi possível gerar o QR Code. Tente novamente.');
    } finally { sending.current = false; if (alive.current) setBusy(false); }
  };
  return <div>
    <div className="mb-6 flex items-start gap-3">
      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"><Smartphone aria-hidden className="h-6 w-6" /></span>
      <div><h2 className="text-2xl font-bold tracking-tight text-text">Conecte seu WhatsApp</h2>
      <p className="mt-2 text-sm leading-relaxed text-text-secondary">Use o celular com o número que vai atender seus clientes.</p></div>
    </div>
    <div className="grid gap-7 md:grid-cols-2 md:items-center lg:gap-8 xl:gap-12">
    <div className="order-2 md:order-1">
      <p className="mb-5 text-xs font-semibold uppercase tracking-wider text-primary">No seu celular</p>
      <ol className="space-y-5 text-sm leading-relaxed text-text-secondary">
        <li className="flex items-start gap-3"><span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-xs font-bold text-primary">01</span><span className="pt-1">Abra o <strong className="text-text">WhatsApp</strong> no celular.</span></li>
        <li className="flex items-start gap-3"><span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-xs font-bold text-primary">02</span><span className="pt-1">Toque em <strong className="text-text">Aparelhos conectados → Conectar aparelho</strong>.</span></li>
        <li className="flex items-start gap-3"><span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-xs font-bold text-primary">03</span><span className="pt-1">Aponte a câmera para o <strong className="text-text">QR Code</strong> desta tela.</span></li>
      </ol>
      <p className="mt-7 rounded-xl border border-border-subtle bg-bg p-4 text-xs leading-relaxed text-text-secondary">Conectar o número não ativa campanhas nem envia mensagens.</p>
    </div>
    <div className="order-1 flex min-w-0 flex-col md:order-2 items-center rounded-2xl border border-border-subtle bg-bg p-4 sm:p-6 xl:p-7">
      <p className="mb-4 text-xs font-semibold text-primary">Escaneie para conectar</p>
      <div className="flex aspect-square w-full max-w-[260px] items-center justify-center rounded-xl border border-border bg-white p-4">
        {busy ? <div role="status" className="flex flex-col items-center gap-3 text-sm text-text-secondary"><Loader2 aria-hidden className="h-7 w-7 animate-spin text-primary" />Gerando seu QR Code…</div> : qr && remaining > 0 ? <img src={qr} width={208} height={208} alt="QR Code para conectar seu WhatsApp" className="h-full w-full object-contain" /> : <div className="flex flex-col items-center gap-3 px-3 text-center text-sm text-text-secondary"><QrCode aria-hidden className="h-16 w-16 text-primary opacity-40" />{qr ? 'Gere um novo código para continuar.' : 'Seu QR Code aparece aqui.'}</div>}
      </div>
      {role === 'OWNER' ? <>
        <button type="button" disabled={busy} onClick={() => void connect()} className="mt-4 inline-flex min-h-12 w-full max-w-[260px] items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60"><QrCode aria-hidden className="h-4 w-4" />{qr ? 'Gerar novo QR Code' : 'Gerar QR Code'}</button>
        {qr && remaining > 0 && <p role="status" className="mt-3 text-xs text-text-secondary">Escaneie agora. Tempo para escanear: {remaining}s.</p>}
        {qr && <button type="button" disabled={loading || busy} onClick={() => void refresh()} className="mt-2 inline-flex min-h-11 items-center justify-center gap-2 px-2 text-sm font-semibold text-primary disabled:opacity-60"><RefreshCw aria-hidden className="h-4 w-4" />Já escaneei, verificar conexão</button>}
      </> : <p className="mt-4 text-sm text-text-secondary">Peça ao proprietário da conta para conectar o WhatsApp.</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </div>
    </div>
  </div>;
}
