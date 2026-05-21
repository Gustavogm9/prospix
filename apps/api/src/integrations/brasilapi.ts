import { Result } from '@prospix/shared-types';
import { ResultHelper } from '../lib/result.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

export interface CnpjInfo {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia?: string;
  situacaoCadastral: string;
  dataInicioAtividade?: string; // YYYY-MM-DD
  cnaeFiscal?: string;
  uf?: string;
  municipio?: string;
  bairro?: string;
  qsa?: Array<{ nome: string; qual?: string }>;
}

// Token Bucket for 3 req/s rate limit
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private maxTokens: number;
  private refillRate: number;

  constructor(maxTokens: number, refillRatePerSecond: number) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRatePerSecond / 1000;
    this.lastRefill = Date.now();
  }

  private refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  async acquire(tokens = 1): Promise<void> {
    this.refill();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return;
    }
    const needed = tokens - this.tokens;
    const waitMs = needed / this.refillRate;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.refill();
    this.tokens -= tokens;
  }
}

// Rate limiter for CNPJ queries (3 req/s)
const cnpjLimiter = new TokenBucket(3, 3);

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export async function getCnpjInfo(cnpj: string): Promise<Result<CnpjInfo>> {
  const sanitizedCnpj = cnpj.replace(/[^0-9]/g, '');
  if (!sanitizedCnpj || sanitizedCnpj.length !== 14) {
    return ResultHelper.failure({
      code: 'VALIDATION_ERROR',
      message: 'Invalid CNPJ format. Must be 14 digits.',
    });
  }

  // 1. Check Redis Cache
  const cacheKey = `cnpj:${sanitizedCnpj}`;
  try {
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      logger.info({ cnpj: sanitizedCnpj }, 'CNPJ info cache hit');
      return ResultHelper.success(JSON.parse(cachedData) as CnpjInfo);
    }
  } catch (cacheErr) {
    logger.warn({ cacheErr, cnpj: sanitizedCnpj }, 'Failed to read CNPJ from Redis cache');
  }

  // 2. Rate Limit
  await cnpjLimiter.acquire();

  // 3. Try BrasilAPI
  try {
    logger.info({ cnpj: sanitizedCnpj }, 'Fetching CNPJ from BrasilAPI');
    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${sanitizedCnpj}`);
    
    // Fallback if 5xx or rate limited
    if (response.status >= 500 || response.status === 429) {
      logger.warn({ status: response.status, cnpj: sanitizedCnpj }, 'BrasilAPI failed. Trying ReceitaWS fallback.');
      return await getCnpjFromReceitaWs(sanitizedCnpj);
    }

    if (response.status === 404) {
      return ResultHelper.failure({
        code: 'RESOURCE_NOT_FOUND',
        message: 'CNPJ not found on BrasilAPI',
      });
    }

    if (!response.ok) {
      logger.error({ status: response.status, cnpj: sanitizedCnpj }, 'BrasilAPI returned error status');
      return await getCnpjFromReceitaWs(sanitizedCnpj);
    }

    const data = (await response.json()) as any;
    
    // Situacao Cadastral mappings (BrasilAPI returns a code, e.g. 2 = ATIVA)
    let situacao = 'ATIVA';
    if (data.situacao_cadastral !== 2) {
      situacao = 'BAIXADA'; // simplified
    }

    const info: CnpjInfo = {
      cnpj: sanitizedCnpj,
      razaoSocial: data.razao_social || '',
      nomeFantasia: data.nome_fantasia || undefined,
      situacaoCadastral: situacao,
      dataInicioAtividade: data.data_inicio_atividade, // YYYY-MM-DD
      cnaeFiscal: String(data.cnae_fiscal || ''),
      uf: data.uf,
      municipio: data.municipio,
      bairro: data.bairro,
      qsa: data.qsa?.map((partner: any) => ({
        nome: partner.nome_socio || partner.nome,
        qual: partner.qualificacao_socio_descricao || partner.qualificacao_socio,
      })),
    };

    // Cache results
    await cacheCnpjInfo(cacheKey, info);

    return ResultHelper.success(info);
  } catch (err: any) {
    logger.error({ err, cnpj: sanitizedCnpj }, 'BrasilAPI failed due to network/exception. Trying ReceitaWS.');
    return await getCnpjFromReceitaWs(sanitizedCnpj);
  }
}

async function getCnpjFromReceitaWs(cnpj: string): Promise<Result<CnpjInfo>> {
  try {
    logger.info({ cnpj }, 'Fetching CNPJ from ReceitaWS fallback');
    const response = await fetch(`https://receitaws.com.br/v1/cnpj/${cnpj}`);

    if (response.status === 404) {
      return ResultHelper.failure({
        code: 'RESOURCE_NOT_FOUND',
        message: 'CNPJ not found on ReceitaWS',
      });
    }

    if (!response.ok) {
      logger.error({ status: response.status, cnpj }, 'ReceitaWS fallback failed');
      return ResultHelper.failure({
        code: 'EXTERNAL_SERVICE_DOWN',
        message: `CNPJ service down (BrasilAPI & ReceitaWS failed). ReceitaWS status: ${response.status}`,
      });
    }

    const data = (await response.json()) as any;

    if (data.status === 'ERROR') {
      logger.error({ error: data.message, cnpj }, 'ReceitaWS returned an error message');
      return ResultHelper.failure({
        code: 'RESOURCE_NOT_FOUND',
        message: data.message || 'CNPJ not found on ReceitaWS',
      });
    }

    // Convert date "DD/MM/YYYY" to ISO "YYYY-MM-DD" if present
    let formattedDate = undefined;
    if (data.abertura) {
      const parts = data.abertura.split('/');
      if (parts.length === 3) {
        formattedDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
    }

    const info: CnpjInfo = {
      cnpj,
      razaoSocial: data.nome || '',
      nomeFantasia: data.fantasia || undefined,
      situacaoCadastral: data.situacao || 'ATIVA',
      dataInicioAtividade: formattedDate,
      cnaeFiscal: data.atividade_principal?.[0]?.code?.replace(/[^0-9]/g, ''),
      uf: data.uf,
      municipio: data.municipio,
      bairro: data.bairro,
      qsa: data.qsa?.map((partner: any) => ({
        nome: partner.nome,
        qual: partner.qual,
      })),
    };

    // Cache results
    await cacheCnpjInfo(`cnpj:${cnpj}`, info);

    return ResultHelper.success(info);
  } catch (err: any) {
    logger.error({ err, cnpj }, 'ReceitaWS fallback failed due to network/exception');
    return ResultHelper.failure({
      code: 'EXTERNAL_SERVICE_DOWN',
      message: err.message || 'CNPJ services are down.',
    });
  }
}

async function cacheCnpjInfo(key: string, info: CnpjInfo): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(info), 'EX', CACHE_TTL_SECONDS);
  } catch (err) {
    logger.warn({ err, key }, 'Failed to cache CNPJ info in Redis');
  }
}
