function isBlockedIpv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return true;
  const a = octets[0] ?? -1;
  const b = octets[1] ?? -1;
  return a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224;
}

export function isAllowedPublicHttpUrl(input: string): boolean {
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    if (url.username || url.password) return false;
    if (url.port && !['80', '443'].includes(url.port)) return false;

    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!hostname || hostname === 'localhost' || hostname === 'metadata.google.internal') return false;
    if (hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) return false;
    // Reject literal IPv6 targets. Public websites may still resolve to IPv6
    // through DNS; this only prevents direct access to local/link-local forms.
    if (hostname.includes(':')) return false;
    if (isBlockedIpv4(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}
