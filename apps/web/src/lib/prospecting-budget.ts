export type ProspectingBudget = {
  dailyBudgetCents: number;
  maxCostPerEligibleLeadCents: number;
  maxProviderCalls: number;
  homologationLeadLimit: number;
  minCostSampleLeads?: number;
};

export type ProspectingBudgetState = {
  providerCalls: number;
  estimatedCostMicros: number;
  processedLeads: number;
  eligibleLeads: number;
  stopped: boolean;
  stopReason: 'MAX_PROVIDER_CALLS' | 'RUN_BUDGET' | 'NO_ELIGIBLE_LEADS' | 'COST_PER_ELIGIBLE_LEAD' | 'HOMOLOGATION_LEAD_LIMIT' | null;
};

export function initialProspectingBudgetState(): ProspectingBudgetState {
  return { providerCalls: 0, estimatedCostMicros: 0, processedLeads: 0, eligibleLeads: 0, stopped: false, stopReason: null };
}

export function applyProspectingUsage(params: {
  budget: ProspectingBudget;
  state: ProspectingBudgetState;
  callCostMicros: number;
  leadProcessed?: boolean;
  leadEligible?: boolean;
}): ProspectingBudgetState {
  if (params.state.stopped) return params.state;
  const next: ProspectingBudgetState = {
    ...params.state,
    providerCalls: params.state.providerCalls + 1,
    estimatedCostMicros: params.state.estimatedCostMicros + Math.max(0, Math.floor(params.callCostMicros)),
    processedLeads: params.state.processedLeads + (params.leadProcessed ? 1 : 0),
    eligibleLeads: params.state.eligibleLeads + (params.leadEligible ? 1 : 0),
  };
  const costCents = Math.ceil(next.estimatedCostMicros / 10_000);
  const costPerEligible = next.eligibleLeads > 0 ? Math.ceil(costCents / next.eligibleLeads) : 0;
  const minimumSample = Math.min(
    params.budget.homologationLeadLimit,
    Math.max(1, params.budget.minCostSampleLeads ?? 5),
  );
  if (next.processedLeads >= params.budget.homologationLeadLimit) {
    next.stopped = true;
    next.stopReason = 'HOMOLOGATION_LEAD_LIMIT';
  } else if (next.providerCalls >= params.budget.maxProviderCalls) {
    next.stopped = true;
    next.stopReason = 'MAX_PROVIDER_CALLS';
  } else if (costCents >= params.budget.dailyBudgetCents) {
    next.stopped = true;
    next.stopReason = 'RUN_BUDGET';
  } else if (
    next.processedLeads >= minimumSample &&
    next.eligibleLeads === 0 &&
    costCents > params.budget.maxCostPerEligibleLeadCents
  ) {
    next.stopped = true;
    next.stopReason = 'NO_ELIGIBLE_LEADS';
  } else if (
    next.processedLeads >= minimumSample &&
    next.eligibleLeads > 0 &&
    costPerEligible > params.budget.maxCostPerEligibleLeadCents
  ) {
    next.stopped = true;
    next.stopReason = 'COST_PER_ELIGIBLE_LEAD';
  }
  return next;
}

export function assertOneSource(sourceTypes: string[]): string {
  const unique = [...new Set(sourceTypes.map((source) => source.trim().toUpperCase()).filter(Boolean))];
  if (unique.length !== 1) throw new Error('Homologacao exige exatamente uma fonte por execucao.');
  return unique[0]!;
}
