import { describe, expect, it } from 'vitest';

import {
  discoveryErrorStatus,
  discoveryRequestSchema,
  isTrustedMutationOrigin,
} from './discovery-request';

const validRequest = {
  tenant_id: '6de57a0c-f8f5-4990-b9c3-87a83d95e75d',
  campaign_id: 'e11fce13-79a9-41f9-afc0-e341a5ad7759',
  source_type: 'GOOGLE_MAPS',
  config: {
    search_tags: ['cardiologista'],
    cities: ['São José do Rio Preto'],
    state: 'SP',
    daily_limit: 20,
    profession: 'DOCTOR',
  },
};

describe('discoveryRequestSchema', () => {
  it('accepts the whitelisted discovery contract', () => {
    expect(discoveryRequestSchema.parse(validRequest)).toMatchObject(validRequest);
  });

  it('rejects unknown fields, oversized batches and unsupported sources', () => {
    expect(() => discoveryRequestSchema.parse({ ...validRequest, admin: true })).toThrow();
    expect(() => discoveryRequestSchema.parse({
      ...validRequest,
      config: { ...validRequest.config, daily_limit: 500 },
    })).toThrow();
    expect(() => discoveryRequestSchema.parse({ ...validRequest, source_type: 'RAW_URL' })).toThrow();
  });
});

describe('isTrustedMutationOrigin', () => {
  it('accepts the same production origin and non-browser bearer calls', () => {
    expect(isTrustedMutationOrigin({
      requestUrl: 'https://app.prospix.com.br/api/discover',
      origin: 'https://app.prospix.com.br',
      forwardedHost: 'app.prospix.com.br',
    })).toBe(true);
    expect(isTrustedMutationOrigin({
      requestUrl: 'https://app.prospix.com.br/api/discover',
      origin: null,
      forwardedHost: null,
    })).toBe(true);
  });

  it('rejects cross-origin browser mutations and malformed configured URLs', () => {
    expect(isTrustedMutationOrigin({
      requestUrl: 'https://app.prospix.com.br/api/discover',
      origin: 'https://evil.example',
      forwardedHost: 'app.prospix.com.br',
    })).toBe(false);
    expect(isTrustedMutationOrigin({
      requestUrl: 'https://app.prospix.com.br/api/discover',
      origin: 'https://evil.example',
      forwardedHost: 'evil.example',
    })).toBe(false);
    expect(isTrustedMutationOrigin({
      requestUrl: 'https://app.prospix.com.br/api/discover',
      origin: 'https://app.prospix.com.br',
      forwardedHost: null,
      configuredAppUrl: 'not-a-url',
    })).toBe(false);
  });
});

describe('discoveryErrorStatus', () => {
  it('maps authorization, rate and state failures without leaking database errors', () => {
    expect(discoveryErrorStatus('DISCOVERY_FORBIDDEN')).toBe(403);
    expect(discoveryErrorStatus('DISCOVERY_RATE_LIMIT_USER')).toBe(429);
    expect(discoveryErrorStatus('DISCOVERY_CAMPAIGN_NOT_ACTIVE')).toBe(409);
    expect(discoveryErrorStatus('DISCOVERY_IDEMPOTENCY_CONFLICT')).toBe(409);
  });
});
