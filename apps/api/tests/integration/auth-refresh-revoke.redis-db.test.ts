/**
 * AUD-P1-017 · Refresh/logout/reuse com DB + Redis reais.
 *
 * Prova que o auth session hardening funciona end-to-end:
 *  1. createSession persiste session com hash do refresh_token (nunca plaintext)
 *  2. rotateSession revoga old session + emite novo refresh + accessTokenId
 *  3. REUSO do refresh velho falha apos rotacao (single-use enforced)
 *  4. Refresh expirado (expiresAt < now) e rejeitado
 *  5. Refresh ja revogado (revokedAt set) e rejeitado
 *  6. revokeSession marca revokedAt no DB + adiciona JTI no Redis (`revoked:{jti}`)
 *     com TTL de 7 dias (matching JWT exp)
 *  7. Apos logout: refresh nao pode mais ser usado
 *  8. JTI revoked sobrevive em Redis ao longo do tempo (TTL > 6 dias)
 *
 * Roda apenas quando AUDIT_REQUIRE_DB=1 e AUDIT_REQUIRE_REDIS=1 (CI ou dev local
 * com Docker provisionado). Caso contrario, skipa com mensagem.
 */
import '../../src/config/env.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { redis } from '../../src/lib/redis.js';
import { hashOpaqueToken } from '../../src/lib/crypto.js';
import {
  createSession,
  rotateSession,
  revokeSession,
  withAuthRlsBypass,
} from '../../src/services/auth-service.js';

const requireDbEvidence = process.env.AUDIT_REQUIRE_DB === '1' || process.env.CI === 'true';
const requireRedisEvidence = process.env.AUDIT_REQUIRE_REDIS === '1' || process.env.CI === 'true';

const db = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

let dbAvailable = true;
let redisAvailable = true;
let adminUserId: string | null = null;
const cleanupSessionIds: string[] = [];
const cleanupJtis: string[] = [];

async function findSeedAdmin(): Promise<string | null> {
  return withAuthRlsBypass(async (tx) => {
    const admin = await tx.user.findFirst({
      where: { email: 'gustavo.macedo@guilds.com.br', role: 'GUILDS_ADMIN' },
      select: { id: true },
    });
    return admin?.id ?? null;
  });
}

async function ensureSessionCleanedUp(sessionIds: string[]) {
  if (sessionIds.length === 0) return;
  await withAuthRlsBypass(async (tx) => {
    await tx.session.deleteMany({ where: { id: { in: sessionIds } } });
  });
}

async function ensureJtisRevokedCleanedUp(jtis: string[]) {
  if (jtis.length === 0) return;
  await Promise.all(jtis.map((jti) => redis.del(`revoked:${jti}`)));
}

describe('AUD-P1-017 · refresh/logout/reuse with DB + Redis backed', () => {
  beforeAll(async () => {
    // Connect Postgres
    try {
      await db.$connect();
      await db.$queryRaw`SELECT 1`;
      adminUserId = await findSeedAdmin();
      if (!adminUserId && requireDbEvidence) {
        throw new Error('Seed admin user not found · run db:seed first');
      }
    } catch (err) {
      dbAvailable = false;
      if (requireDbEvidence) {
        throw new Error(
          `Postgres unavailable for AUD-P1-017 evidence: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // Probe Redis
    try {
      const pong = await redis.ping();
      if (pong !== 'PONG') {
        throw new Error(`Unexpected Redis ping response: ${pong}`);
      }
    } catch (err) {
      redisAvailable = false;
      if (requireRedisEvidence) {
        throw new Error(
          `Redis unavailable for AUD-P1-017 evidence: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  });

  afterEach(async () => {
    // Local per-test cleanup of opportunistic state
    await ensureSessionCleanedUp(cleanupSessionIds.splice(0));
    await ensureJtisRevokedCleanedUp(cleanupJtis.splice(0));
  });

  afterAll(async () => {
    // Final safety cleanup
    if (adminUserId) {
      await withAuthRlsBypass(async (tx) => {
        await tx.session.deleteMany({ where: { userId: adminUserId! } });
      });
    }
    await db.$disconnect();
  });

  it('createSession persiste hash do refresh_token (plaintext NUNCA no DB)', async (context) => {
    if (!dbAvailable || !adminUserId) {
      context.skip();
      return;
    }

    const { refreshToken, accessTokenId, expiresAt } = await createSession({ userId: adminUserId });
    expect(refreshToken).toMatch(/^[a-f0-9]{80}$/); // 40 bytes hex
    expect(accessTokenId).toMatch(/^[0-9a-f-]{36}$/); // UUID

    // Probe DB: stored value DEVE ser hash, não plaintext
    const session = await withAuthRlsBypass((tx) =>
      tx.session.findUnique({ where: { refreshToken: hashOpaqueToken(refreshToken) } }),
    );
    expect(session).not.toBeNull();
    expect(session!.userId).toBe(adminUserId);
    expect(session!.refreshToken).not.toBe(refreshToken); // hash != plaintext
    expect(session!.refreshToken).toBe(hashOpaqueToken(refreshToken));
    expect(session!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(session!.revokedAt).toBeNull();

    // Reasonable expiresAt (~30d)
    const daysAhead = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    expect(daysAhead).toBeGreaterThan(29);
    expect(daysAhead).toBeLessThanOrEqual(30);

    cleanupSessionIds.push(session!.id);
  });

  it('rotateSession emite novo refresh + revoga old + REUSO do old falha', async (context) => {
    if (!dbAvailable || !adminUserId) {
      context.skip();
      return;
    }

    const initial = await createSession({ userId: adminUserId });
    const initialDbRow = await withAuthRlsBypass((tx) =>
      tx.session.findUnique({ where: { refreshToken: hashOpaqueToken(initial.refreshToken) } }),
    );
    cleanupSessionIds.push(initialDbRow!.id);

    // Rotate
    const rotated = await rotateSession(initial.refreshToken, {});
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;

    expect(rotated.value.userId).toBe(adminUserId);
    expect(rotated.value.refreshToken).not.toBe(initial.refreshToken);
    expect(rotated.value.accessTokenId).not.toBe(initial.accessTokenId);

    // Old session: revokedAt deve estar set
    const oldRow = await withAuthRlsBypass((tx) =>
      tx.session.findUnique({ where: { refreshToken: hashOpaqueToken(initial.refreshToken) } }),
    );
    expect(oldRow!.revokedAt).not.toBeNull();

    // New session existe
    const newRow = await withAuthRlsBypass((tx) =>
      tx.session.findUnique({
        where: { refreshToken: hashOpaqueToken(rotated.value.refreshToken) },
      }),
    );
    expect(newRow).not.toBeNull();
    expect(newRow!.revokedAt).toBeNull();
    cleanupSessionIds.push(newRow!.id);

    // ⚡ Tentar reusar o refresh velho · DEVE falhar (reuse detection)
    const reuseAttempt = await rotateSession(initial.refreshToken, {});
    expect(reuseAttempt.ok).toBe(false);
    if (!reuseAttempt.ok) {
      expect(reuseAttempt.error.code).toBe('UNAUTHORIZED');
    }
  });

  it('rotateSession rejeita refresh expirado (expiresAt no passado)', async (context) => {
    if (!dbAvailable || !adminUserId) {
      context.skip();
      return;
    }

    const session = await createSession({ userId: adminUserId });
    const row = await withAuthRlsBypass((tx) =>
      tx.session.findUnique({ where: { refreshToken: hashOpaqueToken(session.refreshToken) } }),
    );
    cleanupSessionIds.push(row!.id);

    // Forçar expiresAt no passado
    await withAuthRlsBypass((tx) =>
      tx.session.update({
        where: { id: row!.id },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      }),
    );

    const result = await rotateSession(session.refreshToken, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNAUTHORIZED');
    }
  });

  it('rotateSession rejeita refresh já revogado (revokedAt set)', async (context) => {
    if (!dbAvailable || !adminUserId) {
      context.skip();
      return;
    }

    const session = await createSession({ userId: adminUserId });
    const row = await withAuthRlsBypass((tx) =>
      tx.session.findUnique({ where: { refreshToken: hashOpaqueToken(session.refreshToken) } }),
    );
    cleanupSessionIds.push(row!.id);

    // Marcar revokedAt manualmente
    await withAuthRlsBypass((tx) =>
      tx.session.update({ where: { id: row!.id }, data: { revokedAt: new Date() } }),
    );

    const result = await rotateSession(session.refreshToken, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNAUTHORIZED');
    }
  });

  it('revokeSession marca revokedAt no DB + adiciona JTI no Redis com TTL 7d', async (context) => {
    if (!dbAvailable || !redisAvailable || !adminUserId) {
      context.skip();
      return;
    }

    const session = await createSession({ userId: adminUserId });
    const row = await withAuthRlsBypass((tx) =>
      tx.session.findUnique({ where: { refreshToken: hashOpaqueToken(session.refreshToken) } }),
    );
    cleanupSessionIds.push(row!.id);

    const jti = `aud-p1-017-${crypto.randomUUID()}`;
    cleanupJtis.push(jti);

    await revokeSession(session.refreshToken, jti);

    // DB: revokedAt set
    const afterRevoke = await withAuthRlsBypass((tx) => tx.session.findUnique({ where: { id: row!.id } }));
    expect(afterRevoke!.revokedAt).not.toBeNull();

    // Redis: chave revoked:{jti} == 'true'
    const flag = await redis.get(`revoked:${jti}`);
    expect(flag).toBe('true');

    // TTL · entre 6 e 7 dias (segundos)
    const ttlSec = await redis.ttl(`revoked:${jti}`);
    const sixDaysSec = 6 * 24 * 60 * 60;
    const sevenDaysSec = 7 * 24 * 60 * 60;
    expect(ttlSec).toBeGreaterThan(sixDaysSec);
    expect(ttlSec).toBeLessThanOrEqual(sevenDaysSec);
  });

  it('apos logout: refresh nao pode mais ser rotacionado', async (context) => {
    if (!dbAvailable || !adminUserId) {
      context.skip();
      return;
    }

    const session = await createSession({ userId: adminUserId });
    const row = await withAuthRlsBypass((tx) =>
      tx.session.findUnique({ where: { refreshToken: hashOpaqueToken(session.refreshToken) } }),
    );
    cleanupSessionIds.push(row!.id);

    await revokeSession(session.refreshToken);

    const afterRotate = await rotateSession(session.refreshToken, {});
    expect(afterRotate.ok).toBe(false);
  });

  it('JTI revoked sobrevive em Redis e TTL nunca volta a aumentar sem nova revogacao', async (context) => {
    if (!dbAvailable || !redisAvailable) {
      // revokeSession usa withAuthRlsBypass internamente · depende do DB tambem
      context.skip();
      return;
    }

    const jti = `aud-p1-017-ttl-${crypto.randomUUID()}`;
    cleanupJtis.push(jti);

    // Revoke sem session real (refresh ficticio · revoke ainda assim adiciona JTI no Redis)
    await revokeSession('fake-refresh-token-for-jti-test', jti);

    const flag = await redis.get(`revoked:${jti}`);
    expect(flag).toBe('true');

    const ttl1 = await redis.ttl(`revoked:${jti}`);
    expect(ttl1).toBeGreaterThan(0);

    // Aguarda 1s e re-checa que TTL caiu (nao subiu)
    await new Promise((r) => setTimeout(r, 1100));
    const ttl2 = await redis.ttl(`revoked:${jti}`);
    expect(ttl2).toBeLessThan(ttl1);
    expect(ttl2).toBeGreaterThan(0);
  });
});
