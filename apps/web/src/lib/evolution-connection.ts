import { buildEvolutionHeaders } from '../../../../supabase/functions/_shared/evolution-auth';

export async function probeEvolutionConnection(channel: { baseUrl: string; apiKey: string; instanceName: string }) {
  if (!channel.baseUrl || !channel.apiKey || !channel.instanceName) return { status: 'unavailable', reason: 'not_configured' };
  const url = `${channel.baseUrl.replace(/\/+$/, '')}/instance/connectionState/${encodeURIComponent(channel.instanceName)}`;
  try {
    const response = await fetch(url, {
      headers: buildEvolutionHeaders(channel.apiKey, {
        basicAuthB64: process.env.EVOLUTION_BASIC_AUTH_B64,
        allowedHost: process.env.EVOLUTION_BASIC_AUTH_HOST, requestUrl: url,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      if (response.status === 404) {
        const payload = await response.json();
        const messages = payload?.response?.message;
        // Resposta real do Evolution para uma instância ainda não provisionada.
        if (payload?.status === 404 && payload?.error === 'Not Found' && Array.isArray(messages)
          && messages.includes(`The "${channel.instanceName}" instance does not exist`)) {
          return { status: 'disconnected', reason: 'instance_not_found' };
        }
      }
      return { status: 'unavailable', reason: 'provider_unavailable' };
    }
    const payload = await response.json();
    const state = String(payload.instance?.state ?? payload.state ?? '').toLowerCase();
    if (!state) return { status: 'unavailable', reason: 'invalid_provider_response' };
    return { status: state === 'open' ? 'connected' : 'disconnected', reason: state === 'open' ? null : state };
  } catch { return { status: 'unavailable', reason: 'provider_unavailable' }; }
}
