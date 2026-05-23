import pino from 'pino';
import { env } from '../config/env.js';

const isDev = env.NODE_ENV === 'development';
const isProd = env.NODE_ENV === 'production';

/**
 * Logger Pino com redaction defensiva.
 *
 * Resolve AUD-P1-007.
 *
 * Regras:
 *  - Campos top-level com nome sensivel sao automaticamente redigidos
 *  - `*.field` cobre 1 nivel de aninhamento (ex.: `req.body.token`)
 *  - Em PRODUCAO, `err.stack` e redigido (vaza paths internos)
 *  - Em DEV, `err.stack` aparece pra facilitar debug
 *  - Para logar erro com seguranca em qualquer ambiente, use `redactError(err)`
 *
 * Testes garantem que redaction bloqueia PII em:
 *  - tests/unit/logger-redaction.test.ts (snapshot)
 */

/** Paths "globais" que SEMPRE sao redigidos · independente do ambiente. */
const ALWAYS_REDACT_PATHS = [
  // Auth headers
  'req.headers.authorization',
  'req.headers.Authorization',
  'req.headers.cookie',
  'req.headers.Cookie',
  'req.headers["x-tenant-id"]',
  'req.headers["x-api-key"]',
  'req.headers["api-key"]',
  'req.headers.apikey',
  'req.headers["asaas-access-token"]',
  'req.headers["asaas-token"]',
  'req.headers["x-evolution-signature"]',

  // Auth bodies
  'req.body.whatsapp',
  'req.body.phone',
  'req.body.number',
  'req.body.email',
  'req.body.password',
  'req.body.token',
  'req.body.accessToken',
  'req.body.refreshToken',

  // Top-level sensitive fields
  'password',
  'pass',
  'senha',
  'token',
  'accessToken',
  'refreshToken',
  'oldRefreshToken',
  'secret',
  'apiKey',
  'api_key',
  'authorization',
  'cookie',
  'signature',
  'whatsapp',
  'phone',
  'telephone',
  'number',
  'email',
  'rawBody',
  'body',
  'payload',
  'messageContent',
  'content',
  'text',
  'recipient',
  'to',

  // One-level nested
  '*.password',
  '*.pass',
  '*.senha',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.oldRefreshToken',
  '*.secret',
  '*.apiKey',
  '*.api_key',
  '*.authorization',
  '*.cookie',
  '*.signature',
  '*.whatsapp',
  '*.phone',
  '*.number',
  '*.telephone',
  '*.email',
  '*.rawBody',
  '*.body',
  '*.payload',
  '*.messageContent',
  '*.content',
  '*.text',
  '*.recipient',
  '*.to',
];

/** Paths redigidos apenas em PRODUCAO · stack/path interno nao deve vazar pra logs persistidos. */
const PRODUCTION_ONLY_REDACT_PATHS = [
  'err.stack',
  'error.stack',
  '*.stack',
];

export const logger = pino({
  level: isDev ? 'debug' : 'info',
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  redact: {
    paths: isProd
      ? [...ALWAYS_REDACT_PATHS, ...PRODUCTION_ONLY_REDACT_PATHS]
      : ALWAYS_REDACT_PATHS,
    censor: '*** [PII REDACTED]',
  },
});

/**
 * Cria objeto de erro seguro pra log, independente do ambiente.
 *
 * - Em PRODUCAO: nao expoe stack
 * - Em qualquer ambiente: nao expoe propriedades nao-enumeraveis ou response.data brutos
 * - Para erros do Axios, extrai apenas status/url sem incluir body do response
 *
 * Uso:
 *   try { ... } catch (err) {
 *     logger.error({ err: redactError(err), tenant_id, trace_id }, 'falha na operacao');
 *   }
 */
export function redactError(err: unknown): {
  type: string;
  message: string;
  stack?: string;
  code?: string | number;
  status?: number;
  url?: string;
} {
  if (err === null || err === undefined) {
    return { type: 'Unknown', message: 'no error provided' };
  }

  if (typeof err === 'string') {
    return { type: 'StringError', message: err };
  }

  if (!(err instanceof Error)) {
    return { type: 'NonError', message: String(err) };
  }

  const base = {
    type: err.name || 'Error',
    message: err.message,
    ...(isProd ? {} : { stack: err.stack }),
  };

  // Axios-like errors: extract minimal context without body
  const axiosLike = err as Error & {
    code?: string | number;
    response?: { status?: number };
    config?: { url?: string };
  };
  if (axiosLike.code !== undefined) {
    (base as Record<string, unknown>).code = axiosLike.code;
  }
  if (axiosLike.response?.status !== undefined) {
    (base as Record<string, unknown>).status = axiosLike.response.status;
  }
  if (axiosLike.config?.url) {
    (base as Record<string, unknown>).url = axiosLike.config.url;
  }

  return base;
}
