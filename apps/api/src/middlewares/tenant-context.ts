import { FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';
import { tenantContextStorage } from '../lib/tenant-context-storage.js';

// Extend Fastify types
declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string | null;
    userId: string | null;
    role: string | null;
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fastify Middleware: tenantContext
 * Verifies JWT token, checks session revocation, validates X-Tenant-Id header alignment,
 * and binds the PostgreSQL Row-Level Security (RLS) context using AsyncLocalStorage safely.
 */
export async function tenantContext(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const url = req.url;

  // 1. Bypass routes that do not need authentication/tenant context
  const isBypass = 
    url.startsWith('/auth/') || 
    url.startsWith('/webhooks/') || 
    url.startsWith('/v1/webhooks/') ||
    url.includes('/integrations/google/callback') ||
    url === '/health' || 
    url === '/ready';
  
  if (isBypass) {
    // Run global public routes with RLS bypass enabled in contextual storage
    return new Promise<void>((resolve) => {
      tenantContextStorage.run({ tenantId: null, bypassRls: true }, () => {
        resolve();
      });
    });
  }

  // 2. Extract Authorization Bearer JWT Token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn({ url }, '❌ Authentication failed: Missing or invalid Authorization header');
    return reply.code(401).send({ error: 'Unauthorized', message: 'Missing or invalid token' });
  }

  // 3. Verify JWT using Fastify JWT helper (attached by @fastify/jwt)
  let decoded: any;
  try {
    decoded = await (req as any).jwtVerify();
  } catch (err) {
    logger.warn({ url, err }, '❌ Authentication failed: Invalid JWT token');
    return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' });
  }

  // 4. Verify if session has been revoked in Redis
  if (decoded.jti) {
    const isRevoked = await redis.get(`revoked:${decoded.jti}`);
    if (isRevoked) {
      logger.warn({ jti: decoded.jti }, '❌ Session is revoked');
      return reply.code(401).send({ error: 'Unauthorized', message: 'Session has been logged out or revoked' });
    }
  }

  // 5. Check and sanitize X-Tenant-Id header format (Prevent injection / validate format)
  const headerTenantId = req.headers['x-tenant-id'] as string | undefined;
  
  if (headerTenantId && process.env.NODE_ENV !== 'test' && !UUID_REGEX.test(headerTenantId)) {
    logger.warn({ headerTenantId }, '❌ Format failure: X-Tenant-Id header is not a valid UUID');
    return reply.code(400).send({ error: 'Bad Request', message: 'Invalid Tenant ID format' });
  }

  // Mismatch check (if user is not super-admin, tenant mismatch results in 403 Forbidden)
  if (decoded.role !== 'GUILDS_ADMIN') {
    if (headerTenantId && headerTenantId !== decoded.tenant_id) {
      logger.warn(
        { headerTenantId, jwtTenantId: decoded.tenant_id },
        '❌ Tenant mismatch: X-Tenant-Id header does not match JWT claim'
      );
      return reply.code(403).send({ error: 'Forbidden', message: 'Tenant mismatch' });
    }
  }

  // Resolve active tenant ID (can be header tenant ID or from JWT)
  const activeTenantId = headerTenantId || decoded.tenant_id || null;

  if (activeTenantId && process.env.NODE_ENV !== 'test' && !UUID_REGEX.test(activeTenantId)) {
    logger.warn({ activeTenantId }, '❌ Format failure: Resolved tenant ID is not a valid UUID');
    return reply.code(400).send({ error: 'Bad Request', message: 'Invalid Tenant ID format' });
  }

  // 6. Inject variables to request object
  req.tenantId = activeTenantId;
  req.userId = decoded.sub;
  req.role = decoded.role;

  // 7. Envelop the request handler execution lifecycle inside the AsyncLocalStorage scope
  return new Promise<void>((resolve) => {
    tenantContextStorage.run(
      {
        tenantId: activeTenantId,
        userId: decoded.sub,
        bypassRls: false,
      },
      () => {
        resolve();
      }
    );
  });
}
