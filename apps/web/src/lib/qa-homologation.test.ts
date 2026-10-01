import { describe, expect, it } from 'vitest';

import { canBypassTenantOutboundPause } from '../../../../supabase/functions/_shared/qa-homologation';

describe('canBypassTenantOutboundPause', () => {
  it('permits only an allowlisted lead in an active homologation campaign', () => {
    expect(canBypassTenantOutboundPause({
      tenantOutboundAllowed: false,
      campaignActive: true,
      homologationMode: true,
      leadAllowlisted: true,
    })).toBe(true);
  });

  it.each([
    { campaignActive: false, homologationMode: true, leadAllowlisted: true },
    { campaignActive: true, homologationMode: false, leadAllowlisted: true },
    { campaignActive: true, homologationMode: true, leadAllowlisted: false },
  ])('fails closed when any QA gate is missing', (gate) => {
    expect(canBypassTenantOutboundPause({
      tenantOutboundAllowed: false,
      ...gate,
    })).toBe(false);
  });
});
