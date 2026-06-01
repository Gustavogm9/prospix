import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  sendMagicLink,
  validateMagicLink,
  signInWithPassword,
  signOut,
  changePassword,
} from '../../services/auth-service.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { verifyInvitation, redeemInvitation } from '../../services/invitation-service.js';
import { logger } from '../../lib/logger.js';

// =============================================================================
// Auth Routes — Supabase Auth
// =============================================================================
// All routes use Supabase Auth instead of custom JWT (RS256) + session table.
// Login/Admin-login → Supabase signInWithPassword()
// Refresh → REMOVED (Supabase client auto-refreshes)
// Logout → Supabase signOut()
// Change password → Supabase updateUserById()
// Invitation redeem → Supabase createUser() + DB record
// Magic link → Kept as custom (WhatsApp via Evolution API, disabled for now)
// =============================================================================

export const authRoutes: FastifyPluginAsync = async (app) => {

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

    // Fetch user details from DB
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, tenant_id, name, email, role')
      .eq('id', user_id)
      .single();

    if (error || !user) {
      return reply.code(404).send({
        error: 'RESOURCE_NOT_FOUND',
        message: 'User no longer exists',
      });
    }

    // Sign in via Supabase to get session tokens
    // For magic link, we use admin.generateLink or sign in with a temporary mechanism
    // Since magic link is currently disabled, this is a fallback
    logger.info({ userId: user.id, tenantId: tenant_id }, '🔑 Magic Link callback: user authenticated');

    return reply.code(200).send({
      user: {
        id: user.id,
        tenant_id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  });

  // ── 3. POST /auth/login ────────────────────────────────────────────────────
  const loginSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
  });

  app.post('/login', async (req: FastifyRequest, reply: FastifyReply) => {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        message: parseResult.error.errors[0]?.message,
      });
    }

    const { email, password } = parseResult.data;

    // Sign in via Supabase Auth
    const signInResult = await signInWithPassword(email, password);

    if (!signInResult.ok) {
      return reply.code(401).send({
        error: 'UNAUTHORIZED',
        message: 'Credenciais incorretas.',
      });
    }

    const { accessToken, refreshToken } = signInResult.value;

    // Fetch user details + tenant from DB
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, tenant_id, name, email, role, preferences, tenants!inner(status)')
      .eq('email', email)
      .in('role', ['OWNER', 'ASSISTANT'])
      .single();

    if (userError || !user) {
      return reply.code(401).send({
        error: 'UNAUTHORIZED',
        message: 'Corretor não encontrado ou credenciais incorretas.',
      });
    }

    // Check if tenant is active
    const tenant = (user as any).tenants;
    if (tenant && tenant.status !== 'ACTIVE') {
      return reply.code(403).send({
        error: 'TENANT_INACTIVE',
        message: 'Acesso bloqueado. A corretora associada não está ativa.',
      });
    }

    // Check must_change_password flag
    const prefs = (user.preferences as Record<string, any>) || {};
    const mustChangePassword = !!prefs.mustChangePassword;

    return reply.code(200).send({
      access_token: accessToken,
      refresh_token: refreshToken,
      must_change_password: mustChangePassword,
      user: {
        id: user.id,
        tenant_id: user.tenant_id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  });

  // ── 4. POST /auth/admin-login ──────────────────────────────────────────────
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

    // Sign in via Supabase Auth
    const signInResult = await signInWithPassword(email, password);

    if (!signInResult.ok) {
      return reply.code(401).send({
        error: 'UNAUTHORIZED',
        message: 'Administrador não encontrado ou credenciais incorretas.',
      });
    }

    const { accessToken, refreshToken } = signInResult.value;

    // Verify user is GUILDS_ADMIN
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, name, email, role')
      .eq('email', email)
      .eq('role', 'GUILDS_ADMIN')
      .single();

    if (userError || !user) {
      return reply.code(401).send({
        error: 'UNAUTHORIZED',
        message: 'Administrador não encontrado ou credenciais incorretas.',
      });
    }

    return reply.code(200).send({
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        tenant_id: null,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  });

  // ── 5. POST /auth/logout ───────────────────────────────────────────────────
  app.post('/logout', async (req: FastifyRequest, reply: FastifyReply) => {
    // Extract user ID from the Supabase JWT (if valid)
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        const { data: { user } } = await supabaseAdmin.auth.getUser(token);
        if (user) {
          await signOut(user.id);
        }
      } catch {
        // Ignore if token is already expired — logout is still successful
      }
    }

    return reply.code(200).send({
      success: true,
      message: 'Logged out successfully',
    });
  });

  // ── 6. POST /auth/invitations/verify ───────────────────────────────────────
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

  // ── 7. POST /auth/invitations/redeem ───────────────────────────────────────
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

  // ── 8. PATCH /auth/change-password ────────────────────────────────────────
  const changePasswordSchema = z.object({
    current_password: z.string().min(1, 'Current password is required'),
    new_password: z.string().min(6, 'New password must be at least 6 characters'),
    confirm_password: z.string().min(1, 'Password confirmation is required'),
  }).refine((data) => data.new_password === data.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  });

  app.patch('/change-password', async (req: FastifyRequest, reply: FastifyReply) => {
    // Extract user from Supabase JWT
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Token inválido ou expirado.' });
    }

    const token = authHeader.slice(7);
    const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !authUser) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Token inválido ou expirado.' });
    }

    const parseResult = changePasswordSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'Validation Error',
        message: parseResult.error.errors[0]?.message,
      });
    }

    const { current_password, new_password } = parseResult.data;

    // Verify current password by attempting to sign in
    const verifyResult = await signInWithPassword(authUser.email!, current_password);
    if (!verifyResult.ok) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Senha atual incorreta.' });
    }

    // Update password via Supabase Admin
    const changeResult = await changePassword(authUser.id, new_password);
    if (!changeResult.ok) {
      return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Falha ao alterar senha.' });
    }

    // Clear mustChangePassword flag in DB
    const { data: dbUser } = await supabaseAdmin
      .from('users')
      .select('preferences')
      .eq('id', authUser.id)
      .single();

    if (dbUser) {
      const prefs = (dbUser.preferences as Record<string, any>) || {};
      delete prefs.mustChangePassword;
      await supabaseAdmin
        .from('users')
        .update({ preferences: prefs })
        .eq('id', authUser.id);
    }

    return reply.code(200).send({
      success: true,
      message: 'Senha alterada com sucesso.',
    });
  });
};

export default authRoutes;
