import { FastifyRequest, FastifyReply } from 'fastify';
import { supabaseAdmin } from '../lib/supabase.js';

/**
 * Middleware helper to manually enforce JWT verification on bypassed routes if needed.
 * Uses Supabase Auth to verify the token (replaces @fastify/jwt verify).
 */
export async function verifyJWT(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Unauthorized', message: 'Missing or invalid token' });
  }

  const token = authHeader.slice(7);
  const { error } = await supabaseAdmin.auth.getUser(token);

  if (error) {
    return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' });
  }
}

/**
 * Middleware factory to enforce specific user role requirements.
 */
export function requireRole(allowedRoles: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const role = req.role;
    if (!role || !allowedRoles.includes(role)) {
      return reply.code(403).send({ error: 'Forbidden', message: 'Insufficient permissions' });
    }
  };
}
