type EvolutionHeaderOptions = {
  basicAuthB64?: string | null;
  requestUrl?: string | null;
  allowedHost?: string | null;
};

function normalizedHost(value: string | null | undefined): string {
  const candidate = String(value || '').trim();
  if (!candidate) return '';

  try {
    return new URL(
      candidate.includes('://') ? candidate : `https://${candidate}`,
    ).hostname.toLowerCase();
  } catch (_err) {
    return '';
  }
}

export function buildEvolutionHeaders(
  apiKey: string,
  options: EvolutionHeaderOptions = {},
): Record<string, string> {
  const headers: Record<string, string> = { apikey: apiKey };
  const basicAuthB64 = String(options.basicAuthB64 || '')
    .trim()
    .replace(/^Basic\s+/i, '')
    .trim();

  if (!basicAuthB64) return headers;

  const requestHost = normalizedHost(options.requestUrl);
  const allowedHost = normalizedHost(options.allowedHost);
  if (!requestHost || !allowedHost || requestHost !== allowedHost) return headers;

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(basicAuthB64)) {
    throw new Error('EVOLUTION_BASIC_AUTH_B64_INVALID');
  }

  headers.Authorization = `Basic ${basicAuthB64}`;
  return headers;
}
