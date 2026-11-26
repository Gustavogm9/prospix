import { apiFetch } from './api-fetch';

export async function requestOnboardingQr(): Promise<string> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error('QR_TIMEOUT'));
      controller.abort();
    }, 20_000);
  });
  // O prazo inclui sessão, eventual renovação, rede e leitura da resposta.
  const generate = async () => {
    const response = await apiFetch('/api/integrations/whatsapp/connect', {
      method: 'POST', signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok || typeof result.qrcode !== 'string' || !result.qrcode.trim()) throw new Error('QR_UNAVAILABLE');
    const value = result.qrcode.trim();
    if (value.startsWith('data:') && !/^data:image\/(png|jpeg|webp);base64,/i.test(value)) throw new Error('QR_INVALID');
    if (!value.startsWith('data:') && !/^[A-Za-z0-9+/=\r\n]+$/.test(value)) throw new Error('QR_INVALID');
    return value.startsWith('data:') ? value : `data:image/png;base64,${value}`;
  };
  try { return await Promise.race([generate(), deadline]); }
  finally { clearTimeout(timer!); }
}
