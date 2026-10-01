import { describe, expect, it } from 'vitest';

import {
  applyProspectingUsage,
  assertOneSource,
  initialProspectingBudgetState,
} from './prospecting-budget';

describe('prospecting homologation controls', () => {
  it('processes a 12-lead fixture from one source and stops at the 10-lead homologation cap', () => {
    expect(assertOneSource(Array(12).fill('GOOGLE_MAPS'))).toBe('GOOGLE_MAPS');
    let state = initialProspectingBudgetState();
    for (let index = 0; index < 12; index++) {
      state = applyProspectingUsage({
        budget: { dailyBudgetCents: 200, maxCostPerEligibleLeadCents: 50, maxProviderCalls: 60, homologationLeadLimit: 10 },
        state,
        callCostMicros: 20_000,
        leadProcessed: true,
        leadEligible: index % 2 === 0,
      });
      if (state.stopped) break;
    }
    expect(state.processedLeads).toBe(10);
    expect(state.stopReason).toBe('HOMOLOGATION_LEAD_LIMIT');
  });

  it('stops when cost per eligible lead exceeds the campaign ceiling', () => {
    let state = initialProspectingBudgetState();
    for (let index = 0; index < 5; index++) {
      state = applyProspectingUsage({
        budget: { dailyBudgetCents: 500, maxCostPerEligibleLeadCents: 5, maxProviderCalls: 100, homologationLeadLimit: 20 },
        state,
        callCostMicros: 60_000,
        leadProcessed: true,
        leadEligible: index === 0,
      });
    }
    expect(state.stopped).toBe(true);
    expect(state.stopReason).toBe('COST_PER_ELIGIBLE_LEAD');
  });

  it('stops a sampled run that spends above the ceiling without one eligible lead', () => {
    let state = initialProspectingBudgetState();
    for (let index = 0; index < 5; index++) {
      state = applyProspectingUsage({
        budget: { dailyBudgetCents: 500, maxCostPerEligibleLeadCents: 5, maxProviderCalls: 100, homologationLeadLimit: 20 },
        state,
        callCostMicros: 20_000,
        leadProcessed: true,
        leadEligible: false,
      });
    }
    expect(state.stopReason).toBe('NO_ELIGIBLE_LEADS');
  });

  it('rejects mixing providers in the same homologation run', () => {
    expect(() => assertOneSource(['GOOGLE_MAPS', 'CNPJ_MINER'])).toThrow('exatamente uma fonte');
  });
});
