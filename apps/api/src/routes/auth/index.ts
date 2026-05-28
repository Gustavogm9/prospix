import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  sendMagicLink,
  validateMagicLink,
  createSession,
  rotateSession,
  revokeSession,
  withAuthRlsBypass,
} from '../../services/auth-service.js';
import { prisma } from '../../lib/prisma.js';
import { verifyInvitation, redeemInvitation } from '../../services/invitation-service.js';
import { verifyPassword, hashPassword } from '../../lib/crypto.js';

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
      jti: session.accessTokenId,
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

    const { userId, refreshToken, accessTokenId } = result.value;

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
      jti: accessTokenId,
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
      password: z.string().min(6, 'Password must be at least 6 characters long'),
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
      password: user.password,
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

  // ── 7. POST /auth/login ────────────────────────────────────────────────────
  const brokerLoginSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
  });

  app.post('/login', async (req: FastifyRequest, reply: FastifyReply) => {
    const parseResult = brokerLoginSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        message: parseResult.error.errors[0]?.message,
      });
    }

    const { email, password } = parseResult.data;

    // Verify user exists and is OWNER or ASSISTANT (scoped DB-role bypass for auth only)
    const user = await withAuthRlsBypass((tx) => tx.user.findFirst({
      where: {
        email,
        role: { in: ['OWNER', 'ASSISTANT'] },
      },
      include: {
        tenant: true,
      },
    }));

    if (!user) {
      return reply.code(401).send({
        error: 'UNAUTHORIZED',
        message: 'Corretor não encontrado ou credenciais incorretas.',
      });
    }

    // Check if tenant is active
    if (!user.tenant || user.tenant.status !== 'ACTIVE') {
      return reply.code(403).send({
        error: 'TENANT_INACTIVE',
        message: 'Acesso bloqueado. A corretora associada não está ativa.',
      });
    }

    // Verify hashed password from the database
    if (!user.passwordHash || !verifyPassword(password, user.passwordHash)) {
      return reply.code(401).send({
        error: 'UNAUTHORIZED',
        message: 'Senha incorreta.',
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
      tenant_id: user.tenantId,
      role: user.role,
      email: user.email,
      name: user.name,
      jti: session.accessTokenId,
    };

    const accessToken = app.jwt.sign(payload);

    return reply.code(200).send({
      access_token: accessToken,
      refresh_token: session.refreshToken,
      must_change_password: !!(user.preferences as any)?.mustChangePassword,
      user: {
        id: user.id,
        tenant_id: user.tenantId,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  });

  // ── 8. POST /auth/admin-login ──────────────────────────────────────────────
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

    // Verify user exists and is a GUILDS_ADMIN (scoped DB-role bypass for auth only)
    const user = await withAuthRlsBypass((tx) => tx.user.findFirst({
      where: {
        email,
        role: 'GUILDS_ADMIN',
      },
    }));

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
      jti: session.accessTokenId,
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

  // ── 9. PATCH /auth/change-password ────────────────────────────────────────
  const changePasswordSchema = z.object({
    current_password: z.string().min(1, 'Current password is required'),
    new_password: z.string().min(6, 'New password must be at least 6 characters'),
    confirm_password: z.string().min(1, 'Password confirmation is required'),
  }).refine((data) => data.new_password === data.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  });

  app.patch('/change-password', async (req: FastifyRequest, reply: FastifyReply) => {
    // Require valid JWT
    try {
      await (req as any).jwtVerify();
    } catch (_) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Token inválido ou expirado.' });
    }

    const userId = (req as any).user?.sub;
    if (!userId) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Usuário não identificado.' });
    }

    const parseResult = changePasswordSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        message: parseResult.error.errors[0]?.message,
      });
    }

    const { current_password, new_password } = parseResult.data;

    const user = await withAuthRlsBypass((tx) => tx.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true, preferences: true },
    }));

    if (!user) {
      return reply.code(404).send({ error: 'RESOURCE_NOT_FOUND', message: 'Usuário não encontrado.' });
    }

    if (!user.passwordHash || !verifyPassword(current_password, user.passwordHash)) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Senha atual incorreta.' });
    }

    // Hash new password and update
    const newHash = hashPassword(new_password);
    const prefs = (user.preferences as Record<string, any>) || {};
    delete prefs.mustChangePassword;

    await withAuthRlsBypass((tx) => tx.user.update({
      where: { id: userId },
      data: {
        passwordHash: newHash,
        preferences: prefs,
      },
    }));

    return reply.code(200).send({
      success: true,
      message: 'Senha alterada com sucesso.',
    });
  });
};

export default authRoutes;
