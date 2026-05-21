import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  sendMagicLink,
  validateMagicLink,
  createSession,
  rotateSession,
  revokeSession,
} from '../../services/auth-service.js';
import { prisma } from '../../lib/prisma.js';
import { verifyInvitation, redeemInvitation } from '../../services/invitation-service.js';
import { verifyPassword } from '../../lib/crypto.js';

export const authRoutes: FastifyPluginAsync = async (app) => {
  
  // Rate limit helper: 10 requests per minute per IP for auth endpoints
  // (We use @fastify/rate-limit if registered, otherwise implement a lightweight fallback or rely on standard plugin registration)
  
  // ── 1. POST /auth/magic-link ───────────────────────────────────────────────
  const magicLinkSchema = z.object({
    whatsapp: z.string().min(8, 'WhatsApp number must be valid'),
  });

  app.post('/magic-link', async (req: FastifyRequest, reply: FastifyReply) => {
    const parseResult = magicLinkSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        message: parseResult.error.errors[0]?.message,
      });
    }

    const { whatsapp } = parseResult.data;
    const result = await sendMagicLink(whatsapp);

    if (!result.ok) {
      const code = result.error.code;
      const status = code === 'UNAUTHORIZED' ? 401 : code === 'VALIDATION_ERROR' ? 400 : 503;
      return reply.code(status).send({
        error: code,
        message: result.error.message,
      });
    }

    return reply.code(200).send({
      success: true,
      message: 'Magic link sent successfully via WhatsApp',
      expires_in: result.value.expires_in,
    });
  });

  // ── 2. GET /auth/callback ──────────────────────────────────────────────────
  const callbackSchema = z.object({
    token: z.string().uuid('Invalid token format'),
  });

  app.get('/callback', async (req: FastifyRequest, reply: FastifyReply) => {
    const parseResult = callbackSchema.safeParse(req.query);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        message: parseResult.error.errors[0]?.message,
      });
    }

    const { token } = parseResult.data;
    const result = await validateMagicLink(token);

    if (!result.ok) {
      return reply.code(400).send({
        error: result.error.code,
        message: result.error.message,
      });
    }

    const { user_id, tenant_id } = result.value;

    // Fetch user details for the JWT payload
    const user = await prisma.user.findUnique({
      where: { id: user_id },
    });

    if (!user) {
      return reply.code(404).send({
        error: 'RESOURCE_NOT_FOUND',
        message: 'User no longer exists',
      });
    }

    // Create session in the database
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'];
    const session = await createSession({
      userId: user.id,
      ipAddress,
      userAgent,
    });

    // Create JWT
    const payload = {
      sub: user.id,
      tenant_id,
      role: user.role,
      email: user.email,
      name: user.name,
      jti: session.refreshToken, // use refresh token or a custom uuid for revocation tracking
    };

    const accessToken = app.jwt.sign(payload);

    return reply.code(200).send({
      access_token: accessToken,
      refresh_token: session.refreshToken,
      user: {
        id: user.id,
        tenant_id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  });

  // ── 3. POST /auth/refresh ──────────────────────────────────────────────────
  const refreshSchema = z.object({
    refresh_token: z.string().min(1, 'Refresh token is required'),
  });

  app.post('/refresh', async (req: FastifyRequest, reply: FastifyReply) => {
    const parseResult = refreshSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        message: parseResult.error.errors[0]?.message,
      });
    }

    const { refresh_token } = parseResult.data;
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'];

    const result = await rotateSession(refresh_token, { ipAddress, userAgent });

    if (!result.ok) {
      return reply.code(401).send({
        error: result.error.code,
        message: result.error.message,
      });
    }

    const { userId, refreshToken } = result.value;

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return reply.code(404).send({
        error: 'RESOURCE_NOT_FOUND',
        message: 'User no longer exists',
      });
    }

    // Re-sign JWT
    const payload = {
      sub: user.id,
      tenant_id: user.tenantId,
      role: user.role,
      email: user.email,
      name: user.name,
      jti: refreshToken,
    };

    const accessToken = app.jwt.sign(payload);

    return reply.code(200).send({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
  });

  // ── 4. POST /auth/logout ───────────────────────────────────────────────────
  const logoutSchema = z.object({
    refresh_token: z.string().min(1, 'Refresh token is required'),
  });

  app.post('/logout', async (req: FastifyRequest, reply: FastifyReply) => {
    const parseResult = logoutSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        message: parseResult.error.errors[0]?.message,
      });
    }

    const { refresh_token } = parseResult.data;

    // Optional: Get JTI from active JWT to blacklist it instantly in Redis
    let jti: string | undefined;
    try {
      const decoded = await (req as any).jwtVerify();
      jti = decoded.jti;
    } catch (_) {
      // Ignore if JWT is already expired/missing - proceed with database refresh token revocation
    }

    await revokeSession(refresh_token, jti);

    return reply.code(200).send({
      success: true,
      message: 'Logged out successfully',
    });
  });

  // ── 5. POST /auth/invitations/verify ───────────────────────────────────────
  const verifyInviteSchema = z.object({
    code: z.string().regex(/^PRSPX-[A-Z0-9]{4}-[A-Z0-9]{4}$/, 'Invalid code format'),
  });

  app.post('/invitations/verify', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = verifyInviteSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        message: parsed.error.errors[0]?.message,
      });
    }

    const { code } = parsed.data;
    const result = await verifyInvitation(code);

    if (!result.ok) {
      const codeError = result.error.code;
      const status = codeError === 'INVITATION_INVALID' ? 404 : 410;
      return reply.code(status).send({
        error: codeError,
        message: result.error.message,
      });
    }

    return reply.code(200).send({
      data: {
        tenant_name: result.value.tenantName,
        role: result.value.role,
      },
    });
  });

  // ── 6. POST /auth/invitations/redeem ───────────────────────────────────────
  const redeemInviteSchema = z.object({
    code: z.string().regex(/^PRSPX-[A-Z0-9]{4}-[A-Z0-9]{4}$/, 'Invalid code format'),
    user: z.object({
      name: z.string().min(1, 'Name is required').max(255),
      email: z.string().email('Invalid email address'),
      whatsapp: z.string().min(8, 'WhatsApp number is required'),
      susep: z.string().optional().nullable(),
      city: z.string().optional().nullable(),
    }),
    accept_terms: z.boolean().refine((val) => val === true, 'You must accept terms and conditions'),
  });

  app.post('/invitations/redeem', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = redeemInviteSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        message: parsed.error.errors[0]?.message,
      });
    }

    const { code, user } = parsed.data;
    const result = await redeemInvitation(code, {
      name: user.name,
      email: user.email,
      whatsapp: user.whatsapp,
      susep: user.susep || undefined,
      city: user.city || undefined,
    });

    if (!result.ok) {
      const codeError = result.error.code;
      const status = codeError === 'INVITATION_INVALID' ? 404 : codeError === 'VALIDATION_ERROR' ? 422 : 410;
      return reply.code(status).send({
        error: codeError,
        message: result.error.message,
      });
    }

    return reply.code(201).send({
      data: {
        user_id: result.value.userId,
        tenant_id: result.value.tenantId,
        magic_link_sent: result.value.magicLinkSent,
        sent_to: 'whatsapp',
      },
    });
  });

  // ── 7. POST /auth/admin-login ──────────────────────────────────────────────
  const adminLoginSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
  });

  app.post('/admin-login', async (req: FastifyRequest, reply: FastifyReply) => {
    const parseResult = adminLoginSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        message: parseResult.error.errors[0]?.message,
      });
    }

    const { email, password } = parseResult.data;

    // Verify user exists and is a GUILDS_ADMIN (RLS bypass search)
    const user = await prisma.user.findFirst({
      where: {
        email,
        role: 'GUILDS_ADMIN',
      },
    });

    if (!user) {
      return reply.code(401).send({
        error: 'UNAUTHORIZED',
        message: 'Administrador não encontrado ou credenciais incorretas.',
      });
    }

    // Verify hashed password from the database
    if (!user.passwordHash || !verifyPassword(password, user.passwordHash)) {
      return reply.code(401).send({
        error: 'UNAUTHORIZED',
        message: 'Senha secreta administrativa incorreta.',
      });
    }

    // Create session in the database
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'];
    const session = await createSession({
      userId: user.id,
      ipAddress,
      userAgent,
    });

    // Create JWT
    const payload = {
      sub: user.id,
      tenant_id: null,
      role: user.role,
      email: user.email,
      name: user.name,
      jti: session.refreshToken,
    };

    const accessToken = app.jwt.sign(payload);

    return reply.code(200).send({
      access_token: accessToken,
      refresh_token: session.refreshToken,
      user: {
        id: user.id,
        tenant_id: null,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  });
};

export default authRoutes;
