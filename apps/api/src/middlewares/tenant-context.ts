import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';

// Extend Fastify types
declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string | null;
    userId: string | null;
    role: string | null;
  }
}

/**
 * Fastify Middleware: tenantContext
 * Verifies JWT token, checks session revocation, validates X-Tenant-Id header alignment,
 * and sets PostgreSQL row-level security (RLS) context using set_config.
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
    return;
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

  // 5. Check X-Tenant-Id alignment
  const headerTenantId = req.headers['x-tenant-id'];
  
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
  const activeTenantId = (headerTenantId as string) || decoded.tenant_id || null;

  // 6. Set PostgreSQL session level config for multi-tenant RLS
  try {
    if (activeTenantId) {
      // Injects tenant_id. Using executeRawUnsafe to guarantee format
      await prisma.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${activeTenantId}', true)`);
      await prisma.$executeRawUnsafe(`SELECT set_config('app.user_id', '${decoded.sub}', true)`);
    } else {
      await prisma.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '', true)`);
      await prisma.$executeRawUnsafe(`SELECT set_config('app.user_id', '', true)`);
    }
  } catch (err) {
    logger.error({ err, activeTenantId }, '❌ Failed to inject RLS context to PostgreSQL');
    return reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to configure tenant context' });
  }

  // 7. Inject variables to request object
  req.tenantId = activeTenantId;
  req.userId = decoded.sub;
  req.role = decoded.role;
}
