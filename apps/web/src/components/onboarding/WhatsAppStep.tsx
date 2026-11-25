'use client';
import { useEffect, useRef, useState } from 'react';
import { Loader2, QrCode, RefreshCw, Smartphone } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import { useAuthStore } from '@/store/auth-store';
import { useOnboardingProgress } from './OnboardingProgressContext';

export function WhatsAppStep() {
  const role = useAuthStore(state => state.user?.role);
  const { loading, progress, refresh } = useOnboardingProgress();
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
      const response = await apiFetch('/api/integrations/whatsapp/connect', { method: 'POST', signal: AbortSignal.timeout(20_000) });
      const result = await response.json();
      if (!response.ok || typeof result.qrcode !== 'string' || !result.qrcode.trim()) throw new Error('QR_UNAVAILABLE');
      const value = result.qrcode.trim();
      if (value.startsWith('data:') && !/^data:image\/(png|jpeg|webp);base64,/i.test(value)) throw new Error('QR_INVALID');
      if (!value.startsWith('data:') && !/^[A-Za-z0-9+/=\r\n]+$/.test(value)) throw new Error('QR_INVALID');
      if (!alive.current) return;
      setQr(value.startsWith('data:') ? value : `data:image/png;base64,${value}`);
      setExpiresAt(Date.now() + 40_000);
    } catch {
      if (alive.current) setError('Não foi possível gerar o QR Code. Tente novamente.');
    } finally { sending.current = false; if (alive.current) setBusy(false); }
  };
  return <div>
    <div className="mb-6 flex items-start gap-3">
      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/5 text-primary"><Smartphone aria-hidden className="h-6 w-6" /></span>
      <div><h2 className="text-2xl font-bold tracking-tight text-text">Conecte seu WhatsApp</h2>
      <p className="mt-2 text-sm leading-relaxed text-text-secondary">Use o celular com o número que vai atender seus clientes.</p></div>
    </div>
    <div className="grid gap-7 md:grid-cols-2 md:items-center">
    <div className="order-2 md:order-1">
      <ol className=" space-y-4 text-sm leading-relaxed text-text-secondary">
        <li><strong className="text-text">1.</strong> Abra o WhatsApp no celular.</li>
        <li><strong className="text-text">2.</strong> Toque em <strong className="text-text">Aparelhos conectados → Conectar aparelho</strong>.</li>
        <li><strong className="text-text">3.</strong> Aponte a câmera para o QR Code desta tela.</li>
      </ol>
      <p className="mt-5 text-xs leading-relaxed text-text-secondary">Conectar o número não ativa campanhas nem envia mensagens.</p>
    </div>
    <div className="order-1 flex min-w-0 flex-col md:order-2 items-center rounded-2xl border border-border bg-bg p-4 sm:p-6">
      <div className="flex aspect-square w-full max-w-[240px] items-center justify-center rounded-xl border border-border bg-white p-4">
        {busy ? <div role="status" className="flex flex-col items-center gap-3 text-sm text-text-secondary"><Loader2 aria-hidden className="h-7 w-7 animate-spin text-primary" />Gerando seu QR Code…</div> : qr && remaining > 0 ? <img src={qr} width={208} height={208} alt="QR Code para conectar seu WhatsApp" className="h-full w-full object-contain" /> : <div className="flex flex-col items-center gap-3 px-3 text-center text-sm text-text-secondary"><QrCode aria-hidden className="h-16 w-16 text-primary/40" />{qr ? 'Gere um novo código para continuar.' : 'Seu QR Code aparece aqui.'}</div>}
      </div>
      {role === 'OWNER' ? <>
        <button type="button" disabled={busy || loading || !progress} onClick={() => void connect()} className="mt-4 inline-flex min-h-11 w-full max-w-[240px] items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60"><QrCode aria-hidden className="h-4 w-4" />{qr ? 'Gerar novo QR Code' : 'Gerar QR Code'}</button>
        {qr && remaining > 0 && <p role="status" className="mt-3 text-xs text-text-secondary">Escaneie agora. Tempo para escanear: {remaining}s.</p>}
        {qr && <button type="button" disabled={loading || busy} onClick={() => void refresh()} className="mt-2 inline-flex min-h-11 items-center justify-center gap-2 px-2 text-sm font-semibold text-primary disabled:opacity-60"><RefreshCw aria-hidden className="h-4 w-4" />Já escaneei, verificar conexão</button>}
      </> : <p className="mt-4 text-sm text-text-secondary">Peça ao proprietário da conta para conectar o WhatsApp.</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </div>
    </div>
  </div>;
}
