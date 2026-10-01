import { z } from 'zod';

export const DISCOVERY_SOURCES = [
  'GOOGLE_MAPS',
  'CNPJ_MINER',
  'DOCTORALIA',
  'COMPRASNET',
  'VIVAREAL',
  'CRM_SP',
  'OAB_SP',
  'CRO_SP',
  'TAVILY_B2B_SEARCH',
] as const;

const shortText = z.string().trim().min(1).max(120);

export const discoveryRequestSchema = z.object({
  tenant_id: z.string().uuid(),
  campaign_id: z.string().uuid(),
  source_type: z.enum(DISCOVERY_SOURCES),
  config: z.object({
    search_tags: z.array(shortText).max(20).default([]),
    cities: z.array(shortText).max(20).default([]),
    state: z.string().trim().regex(/^[A-Z]{2}$/).default('SP'),
    daily_limit: z.number().int().min(1).max(100).default(20),
    profession: z.enum([
      'DOCTOR',
      'LAWYER',
      'DENTIST',
      'ENTREPRENEUR',
      'ENGINEER',
      'ARCHITECT',
      'ACCOUNTANT',
      'OTHER',
    ]).optional(),
  }).strict(),
}).strict();

export type DiscoveryRequestInput = z.infer<typeof discoveryRequestSchema>;

export function isTrustedMutationOrigin(params: {
  requestUrl: string;
  origin: string | null;
  forwardedHost: string | null;
  configuredAppUrl?: string | null;
}): boolean {
  if (!params.origin) return true;

  let origin: URL;
  try {
    origin = new URL(params.origin);
  } catch {
    return false;
  }

  const requestUrl = new URL(params.requestUrl);
  const hosts = new Set<string>([requestUrl.host.toLowerCase()]);
  // Never trust X-Forwarded-Host as an origin allowlist entry. A client can
  // spoof it when the reverse proxy does not explicitly overwrite the header.
  void params.forwardedHost;

  if (params.configuredAppUrl) {
    try {
      hosts.add(new URL(params.configuredAppUrl).host.toLowerCase());
    } catch {
      return false;
    }
  }

  if (origin.protocol !== 'https:' && requestUrl.hostname !== 'localhost') return false;
  return hosts.has(origin.host.toLowerCase());
}

export function discoveryErrorStatus(code: string): number {
  if (code.includes('RATE_LIMIT') || code === 'DISCOVERY_ALREADY_RUNNING') return 429;
  if (code === 'DISCOVERY_FORBIDDEN') return 403;
  if (code === 'DISCOVERY_CAMPAIGN_NOT_FOUND') return 404;
  if (
    code === 'DISCOVERY_TENANT_NOT_ACTIVE' ||
    code === 'DISCOVERY_CAMPAIGN_NOT_ACTIVE' ||
    code === 'DISCOVERY_SOURCE_NOT_ENABLED' ||
    code === 'DISCOVERY_IDEMPOTENCY_CONFLICT' ||
    code === 'DISCOVERY_DAILY_BUDGET_EXCEEDED'
  ) return 409;
  return 400;
}

export function discoveryErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    DISCOVERY_FORBIDDEN: 'Você não tem permissão para executar esta busca.',
    DISCOVERY_TENANT_NOT_ACTIVE: 'A conta não está ativa para prospecção.',
    DISCOVERY_CAMPAIGN_NOT_FOUND: 'Campanha não encontrada.',
    DISCOVERY_CAMPAIGN_NOT_ACTIVE: 'Ative a campanha antes de executar a busca.',
    DISCOVERY_SOURCE_NOT_ENABLED: 'Essa fonte não está habilitada na campanha.',
    DISCOVERY_RATE_LIMIT_USER: 'Muitas buscas em sequência. Aguarde um minuto.',
    DISCOVERY_RATE_LIMIT_ORIGIN: 'Muitas buscas desta origem. Aguarde um minuto.',
    DISCOVERY_ALREADY_RUNNING: 'Já existe uma busca desta fonte em andamento.',
    DISCOVERY_IDEMPOTENCY_CONFLICT: 'Esta tentativa de busca não corresponde à solicitação original. Atualize a tela e tente novamente.',
    DISCOVERY_DAILY_BUDGET_EXCEEDED: 'O orçamento diário desta campanha foi atingido.',
  };
  return messages[code] ?? 'Não foi possível iniciar a busca.';
}
