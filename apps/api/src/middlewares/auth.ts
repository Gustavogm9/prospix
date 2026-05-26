import { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Middleware helper to manually enforce JWT verification on bypassed routes if needed.
 */
export async function verifyJWT(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await (req as any).jwtVerify();
  } catch {
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
