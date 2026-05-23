/**
 * Testes de redaction de logs (AUD-P1-007).
 *
 * Garante que campos sensiveis SEMPRE saem como "*** [PII REDACTED]" e que
 * payloads de erro nao expoem mensagens brutas ou stack em producao.
 *
 * Estrategia: cria logger Pino isolado com a MESMA config de produção
 * (NODE_ENV=production via override) escrevendo num stream em memoria. Loga
 * fixtures realistas e valida que strings sensiveis nao aparecem no output.
 */
import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { Writable } from 'node:stream';
import { redactError } from '../../src/lib/logger.js';

// Reconstroi a mesma config de redaction usada pelo logger principal,
// mas com stream em memoria pra inspecionar output.
function createTestLogger(mode: 'production' | 'development') {
  const isProd = mode === 'production';

  const ALWAYS_REDACT_PATHS = [
    'req.headers.authorization',
    'req.headers["x-evolution-signature"]',
    'req.body.whatsapp',
    'req.body.password',
    'req.body.token',
    'password',
    'token',
    'accessToken',
    'refreshToken',
    'secret',
    'apiKey',
    'authorization',
    'whatsapp',
    'phone',
    'number',
    'email',
    'body',
    'payload',
    'messageContent',
    'content',
    'text',
    'recipient',
    'to',
    '*.password',
    '*.token',
    '*.accessToken',
    '*.refreshToken',
    '*.secret',
    '*.apiKey',
    '*.whatsapp',
    '*.phone',
    '*.number',
    '*.email',
    '*.body',
    '*.payload',
    '*.messageContent',
    '*.content',
    '*.text',
    '*.recipient',
    '*.to',
  ];

  const PRODUCTION_ONLY_REDACT_PATHS = ['err.stack', 'error.stack', '*.stack'];

  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });

  const logger = pino(
    {
      level: 'trace',
      redact: {
        paths: isProd
          ? [...ALWAYS_REDACT_PATHS, ...PRODUCTION_ONLY_REDACT_PATHS]
          : ALWAYS_REDACT_PATHS,
        censor: '*** [PII REDACTED]',
      },
    },
    stream,
  );

  return { logger, getOutput: () => lines.join('') };
}

describe('Logger · redaction (AUD-P1-007)', () => {
  it('redige whatsapp em top-level', () => {
    const { logger, getOutput } = createTestLogger('production');
    logger.info({ whatsapp: '+5517998764422' }, 'evento');
    const out = getOutput();
    expect(out).not.toContain('+5517998764422');
    expect(out).toContain('[PII REDACTED]');
  });

  it('redige token + secret + apiKey', () => {
    const { logger, getOutput } = createTestLogger('production');
    logger.info(
      {
        token: 'jwt-real-token-here',
        secret: 'super-secret',
        apiKey: 'sk-real-key',
      },
      'auth event',
    );
    const out = getOutput();
    expect(out).not.toContain('jwt-real-token-here');
    expect(out).not.toContain('super-secret');
    expect(out).not.toContain('sk-real-key');
  });

  it('redige content / messageContent / text (corpo de mensagem WhatsApp)', () => {
    const { logger, getOutput } = createTestLogger('production');
    logger.info(
      {
        messageContent: 'Mensagem privada do lead falando de saude',
        content: 'Outro corpo de texto sensivel',
        text: 'Resposta da IA com PII',
      },
      'message sent',
    );
    const out = getOutput();
    expect(out).not.toContain('Mensagem privada');
    expect(out).not.toContain('Outro corpo');
    expect(out).not.toContain('Resposta da IA');
  });

  it('redige campos sensiveis em primeiro nivel nested', () => {
    const { logger, getOutput } = createTestLogger('production');
    logger.info(
      {
        req: { body: { whatsapp: '+5511999990001', password: 'segredo123' } },
      },
      'request received',
    );
    const out = getOutput();
    expect(out).not.toContain('+5511999990001');
    expect(out).not.toContain('segredo123');
  });

  it('redige headers de autenticacao', () => {
    const { logger, getOutput } = createTestLogger('production');
    logger.info(
      {
        req: {
          headers: {
            authorization: 'Bearer real-jwt-here',
            'x-evolution-signature': 'sig-secret-here',
          },
        },
      },
      'inbound webhook',
    );
    const out = getOutput();
    expect(out).not.toContain('real-jwt-here');
    expect(out).not.toContain('sig-secret-here');
  });

  it('redige campos `to` e `recipient` (destinatario WhatsApp)', () => {
    const { logger, getOutput } = createTestLogger('production');
    logger.info(
      {
        to: '+5517998764422',
        recipient: '+5517998764422',
      },
      'message dispatch',
    );
    const out = getOutput();
    expect(out).not.toContain('+5517998764422');
  });

  it('NAO redige campos seguros (tenant_id, trace_id, job_id)', () => {
    const { logger, getOutput } = createTestLogger('production');
    logger.info(
      {
        tenant_id: '11111111-1111-1111-1111-111111111111',
        trace_id: 'trace-abc',
        job_id: 'job-123',
        duration_ms: 42,
      },
      'completed',
    );
    const out = getOutput();
    expect(out).toContain('11111111-1111-1111-1111-111111111111');
    expect(out).toContain('trace-abc');
    expect(out).toContain('job-123');
    expect(out).toContain('42');
  });

  it('redige err.stack em PRODUCAO', () => {
    const { logger, getOutput } = createTestLogger('production');
    const fakeErr = new Error('boom');
    fakeErr.stack = 'Error: boom\n  at /app/internal/secret-path.ts:42';
    logger.error({ err: fakeErr }, 'falha');
    const out = getOutput();
    expect(out).not.toContain('/app/internal/secret-path.ts');
  });

  it('preserva err.stack em DEV (debug)', () => {
    const { logger, getOutput } = createTestLogger('development');
    const fakeErr = new Error('boom');
    fakeErr.stack = 'Error: boom\n  at /app/internal/secret-path.ts:42';
    logger.error({ err: fakeErr }, 'falha');
    const out = getOutput();
    expect(out).toContain('boom');
    // Stack pode aparecer em dev pra ajudar debug
  });
});

describe('redactError() · helper de erro seguro', () => {
  it('extrai type + message de Error padrao', () => {
    const err = new Error('algo deu errado');
    const safe = redactError(err);
    expect(safe.type).toBe('Error');
    expect(safe.message).toBe('algo deu errado');
  });

  it('extrai name customizado', () => {
    class TenantQuotaExceededError extends Error {
      constructor() {
        super('quota exceeded');
        this.name = 'TenantQuotaExceededError';
      }
    }
    const safe = redactError(new TenantQuotaExceededError());
    expect(safe.type).toBe('TenantQuotaExceededError');
    expect(safe.message).toBe('quota exceeded');
  });

  it('extrai apenas status + url de erro Axios-like (NAO response.data)', () => {
    const axiosErr = Object.assign(new Error('Request failed with status code 500'), {
      code: 'ERR_BAD_RESPONSE',
      response: {
        status: 500,
        data: { sensitive: 'should NOT leak', token: 'real-token' },
      },
      config: { url: 'https://api.openai.com/v1/chat/completions' },
    });
    const safe = redactError(axiosErr);
    expect(safe.status).toBe(500);
    expect(safe.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(safe.code).toBe('ERR_BAD_RESPONSE');
    // Critico: data nao deve aparecer
    expect(JSON.stringify(safe)).not.toContain('should NOT leak');
    expect(JSON.stringify(safe)).not.toContain('real-token');
  });

  it('aceita string como erro', () => {
    const safe = redactError('algo deu errado em string');
    expect(safe.type).toBe('StringError');
    expect(safe.message).toBe('algo deu errado em string');
  });

  it('aceita null/undefined', () => {
    expect(redactError(null).message).toBe('no error provided');
    expect(redactError(undefined).message).toBe('no error provided');
  });

  it('aceita objeto nao-Error', () => {
    const safe = redactError({ weird: 'object' });
    expect(safe.type).toBe('NonError');
    expect(safe.message).toContain('[object Object]');
  });

  it('integra com logger · objeto seguro sem stack em prod', () => {
    const { logger, getOutput } = createTestLogger('production');
    const fakeErr = Object.assign(new Error('OpenAI 500'), {
      stack: 'Error: OpenAI 500\n  at /app/secret/path.ts:99',
      response: { status: 500, data: { error: 'leak-this' } },
    });
    logger.error({ err: redactError(fakeErr) }, 'provider falha');
    const out = getOutput();
    expect(out).toContain('OpenAI 500'); // mensagem ok
    expect(out).toContain('500'); // status ok
    expect(out).not.toContain('/app/secret/path.ts'); // stack redigido em prod
    expect(out).not.toContain('leak-this'); // body nunca exposto
  });
});
