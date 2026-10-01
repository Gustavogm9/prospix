import { describe, expect, it } from 'vitest';

import { campaignEnrichmentPolicy } from '../../../../supabase/functions/_shared/enrichment-policy';

describe('campaign enrichment cost policy', () => {
  it('fails closed when deep enrichment is absent or false', () => {
    expect(campaignEnrichmentPolicy({}, ['CNPJ_PREMIUM', 'FIRECRAWL_ENRICHMENT'])).toEqual({
      deepEnrichmentEnabled: false,
      activeSources: new Set(),
    });
    expect(campaignEnrichmentPolicy({ deep_enrichment: false }, ['INSTAGRAM_SCRAPER']).activeSources.size).toBe(0);
  });

  it('allows only tenant-enabled sources after explicit campaign opt-in', () => {
    const policy = campaignEnrichmentPolicy(
      { deep_enrichment: true },
      ['cnpj_premium', 'FIRECRAWL_ENRICHMENT'],
    );
    expect(policy.deepEnrichmentEnabled).toBe(true);
    expect([...policy.activeSources]).toEqual(['CNPJ_PREMIUM', 'FIRECRAWL_ENRICHMENT']);
  });
});
