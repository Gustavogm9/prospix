import { describe, expect, it } from 'vitest';

import { isAllowedPublicHttpUrl } from '../../../../supabase/functions/_shared/public-url';

describe('public enrichment URL gate', () => {
  it('accepts ordinary public web URLs', () => {
    expect(isAllowedPublicHttpUrl('https://clinic.example.com/about')).toBe(true);
    expect(isAllowedPublicHttpUrl('http://example.org')).toBe(true);
  });

  it.each([
    'http://localhost/admin',
    'http://127.0.0.1',
    'http://2130706433',
    'http://0x7f000001',
    'http://10.0.0.2',
    'http://169.254.169.254/latest/meta-data',
    'http://192.168.1.10',
    'http://[::1]',
    'http://user:pass@example.com',
    'http://example.com:8080',
    'file:///etc/passwd',
  ])('rejects local, privileged or non-http target %s', (url) => {
    expect(isAllowedPublicHttpUrl(url)).toBe(false);
  });
});
