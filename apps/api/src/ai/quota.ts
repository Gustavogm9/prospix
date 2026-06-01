import { TenantPlan } from '@prospix/shared-types';
import { dbAdmin } from '../lib/db.js';

export const AI_PLAN_LIMIT_CENTS: Record<TenantPlan, number> = {
  STARTER: 5000,
  STANDARD: 15000,
  PREMIUM: 50000,
};

export const AI_MODEL_PRICING: Record<string, { inputRate: number; outputRate: number }> = {
  'gpt-4o-mini': { inputRate: 0.00000015, outputRate: 0.00000060 },
  'claude-3-5-haiku-20241022': { inputRate: 0.00000080, outputRate: 0.00000400 },
  'gemini-1.5-flash': { inputRate: 0.000000075, outputRate: 0.00000030 },
};

export class AIQuotaExceededError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly currentCostCents: number,
    public readonly estimatedCostCents: number,
    public readonly limitCents: number
  ) {
    super('AI quota exceeded');
    this.name = 'AIQuotaExceededError';
  }
}

export function getCurrentUsageMonth(date = new Date()): Date {
  const periodMonth = new Date(date);
  periodMonth.setDate(1);
  periodMonth.setHours(0, 0, 0, 0);
  return periodMonth;
}

export function getAIPlanLimitCents(plan: TenantPlan | string | null | undefined): number {
  if (plan === TenantPlan.STARTER || plan === 'STARTER') return AI_PLAN_LIMIT_CENTS.STARTER;
  if (plan === TenantPlan.PREMIUM || plan === 'PREMIUM') return AI_PLAN_LIMIT_CENTS.PREMIUM;
  return AI_PLAN_LIMIT_CENTS.STANDARD;
}

export function estimateAICallCostCents(params: {
  model: string;
  messages: Array<{ content: string }>;
  maxTokens: number;
}): number {
  const pricing = AI_MODEL_PRICING[params.model] || { inputRate: 0, outputRate: 0 };
  const estimatedInputTokens = Math.ceil(
    params.messages.reduce((total, message) => total + message.content.length, 0) / 4
  );
  const rawCost = (estimatedInputTokens * pricing.inputRate) + (params.maxTokens * pricing.outputRate);

  return Math.ceil(rawCost * 100);
}

export async function assertAIQuotaBeforeCall(params: {
  tenantId: string;
  model: string;
  messages: Array<{ content: string }>;
  maxTokens: number;
  now?: Date;
}): Promise<void> {
  const periodMonth = getCurrentUsageMonth(params.now);
  const { data: tenant } = await dbAdmin
    .from('tenants')
    .select('id, plan')
    .eq('id', params.tenantId)
    .single();

  const limitCents = getAIPlanLimitCents(tenant?.plan);
  const { data: usage } = await dbAdmin
    .from('tenant_usage')
    .select('llm_cost_cents')
    .eq('tenant_id', params.tenantId)
    .eq('period_month', periodMonth.toISOString())
    .single();

  const currentCostCents = Number(usage?.llm_cost_cents ?? 0);
  const estimatedCostCents = estimateAICallCostCents(params);

  if (currentCostCents + estimatedCostCents >= limitCents) {
    throw new AIQuotaExceededError(
      params.tenantId,
      currentCostCents,
      estimatedCostCents,
      limitCents
    );
  }
}
