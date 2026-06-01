import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import { adminRoutes } from '../../src/routes/admin/index.js';
import { supabaseAdmin } from '../../src/lib/supabase.js';

vi.mock('../../src/lib/supabase.js', () => {
  const chainable = () => ({
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  });
  return {
    supabaseAdmin: {
      from: vi.fn(() => chainable()),
      auth: {
        getUser: vi.fn(),
        admin: {
          createUser: vi.fn(),
          updateUserById: vi.fn(),
          signOut: vi.fn(),
        },
      },
    },
  };
});

vi.mock('../../src/services/invitation-service.js', () => ({
  generateInvitationCode: vi.fn(() => 'PRSPX-A1B2-C3D4'),
  createInvitation: vi.fn().mockResolvedValue({
    ok: true,
    value: { code: 'PRSPX-A1B2-C3D4', id: 'inv-123' },
  }),
  revokeInvitation: vi.fn().mockResolvedValue({
    ok: true,
    value: { id: 'inv-123', revokedAt: new Date() },
  }),
}));

describe('Admin Onboarding Routes', () => {
  let app: ReturnType<typeof fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = fastify();

    // Register routing
    await app.register(adminRoutes);
  });

  it('should block requests if role is NOT GUILDS_ADMIN', async () => {
    app.addHook('preValidation', async (req: any) => {
      req.role = 'OWNER'; // Insufficient permissions
      req.userId = 'user_123';
    });

    const response = await app.inject({
      method: 'POST',
      url: '/tenants',
      payload: {
        name: 'Giovane MetLife',
        slug: 'giovane-metlife',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.payload).message).toContain('permissions');
  });

  it('should successfully onboard a new tenant and create secrets + config', async () => {
    app.addHook('preValidation', async (req: any) => {
      req.role = 'GUILDS_ADMIN'; // Authorized
      req.userId = 'guilds_admin_999';
    });

    // Mock: tenant slug lookup returns null (no duplicate)
    const slugChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };

    const mockTenant = {
      id: 'tenant_xyz',
      name: 'Roberta Prudential',
      slug: 'roberta-prudential',
      plan: 'STANDARD',
      status: 'ONBOARDING',
      mrrCents: 15000,
    };

    // Mock: tenant insert returns new tenant
    const insertChain = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockTenant, error: null }),
    };

    // Mock: secrets/config inserts
    const secretInsertChain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { tenant_id: 'tenant_xyz' }, error: null }),
    };

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'tenants') {
        // First call is slug check, second is insert
        return { ...slugChain, ...insertChain } as any;
      }
      if (table === 'tenant_secrets' || table === 'tenant_ai_configs') {
        return secretInsertChain as any;
      }
      return {} as any;
    });

    const response = await app.inject({
      method: 'POST',
      url: '/tenants',
      payload: {
        name: 'Roberta Prudential',
        slug: 'roberta-prudential',
        plan: 'STANDARD',
        mrrCents: 15000,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.payload)).toEqual(mockTenant);
    expect(supabaseAdmin.from).toHaveBeenCalledWith('tenants');
  });

  it('should return tenant detail without raw credential payload', async () => {
    app.addHook('preValidation', async (req: any) => {
      req.role = 'GUILDS_ADMIN';
      req.userId = 'guilds_admin_999';
    });

    const updatedAt = new Date('2026-05-22T10:00:00.000Z');
    const tenantDetail = {
      id: 'tenant_xyz',
      name: 'Roberta Prudential',
      slug: 'roberta-prudential',
      users: [
        {
          id: 'owner_123',
          name: 'Roberta',
          email: 'roberta@example.com',
          role: 'OWNER',
        },
      ],
      secret: {
        evolution_base_url: 'https://evo.example.com',
        evolution_instance_name: 'tenant_roberta',
        evolution_api_key_encrypted: 'encrypted:evolution-api-key-value',
        evolution_webhook_secret: 'webhook-secret-value',
        google_calendar_id: 'primary',
        google_oauth_refresh_encrypted: 'encrypted:google-refresh-token',
        google_oauth_scope: 'https://www.googleapis.com/auth/calendar.events',
        google_maps_api_key_encrypted: 'encrypted:maps-api-key-value',
        openai_api_key_encrypted: 'encrypted:openai-api-key-value',
        anthropic_api_key_encrypted: null,
        google_ai_api_key_encrypted: 'encrypted:gemini-api-key-value',
        ai_provider: 'GUILDS_SHARED',
        twilio_account_sid_encrypted: 'encrypted:twilio-account-sid',
        twilio_auth_token_encrypted: 'encrypted:twilio-auth-token',
        updated_at: updatedAt,
      },
    };

    vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: tenantDetail, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: tenantDetail, error: null }),
    }) as any);

    const response = await app.inject({
      method: 'GET',
      url: '/tenants/tenant_xyz',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);

    expect(body.data).not.toHaveProperty('secret');
    expect(body.data.credentialState).toEqual({
      exists: true,
      evolution: {
        baseUrlConfigured: true,
        instanceConfigured: true,
        tokenConfigured: true,
        webhookConfigured: true,
      },
      google: {
        calendarConfigured: true,
        oauthConnected: true,
        oauthScope: 'https://www.googleapis.com/auth/calendar.events',
        mapsConfigured: true,
      },
      ai: {
        provider: 'GUILDS_SHARED',
        openaiConfigured: true,
        anthropicConfigured: false,
        googleConfigured: true,
      },
      telephony: {
        accountConfigured: true,
        tokenConfigured: true,
      },
      updatedAt: updatedAt.toISOString(),
    });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('apiKey');
    expect(serialized).not.toContain('clientSecret');
    expect(serialized).not.toContain('encrypted');
    expect(serialized).not.toContain('evolution-api-key-value');
    expect(serialized).not.toContain('google-refresh-token');
    expect(serialized).not.toContain('maps-api-key-value');
    expect(serialized).not.toContain('openai-api-key-value');
    expect(serialized).not.toContain('gemini-api-key-value');
    expect(serialized).not.toContain('twilio-auth-token');
    expect(serialized).not.toContain('webhook-secret-value');
  });

  it('should suspend tenant and pause active campaigns successfully', async () => {
    app.addHook('preValidation', async (req: any) => {
      req.role = 'GUILDS_ADMIN';
      req.userId = 'guilds_admin_999';
    });

    const tenantData = {
      id: 'tenant_xyz',
      name: 'Roberta Prudential',
      status: 'ACTIVE',
    };

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'tenants') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: tenantData, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: tenantData, error: null }),
          update: vi.fn().mockReturnThis(),
        } as any;
      }
      if (table === 'campaigns') {
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { count: 2 }, error: null }),
        } as any;
      }
      return {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: {}, error: null }),
      } as any;
    });

    const response = await app.inject({
      method: 'POST',
      url: '/tenants/tenant_xyz/suspend',
    });

    expect(response.statusCode).toBe(200);
    expect(supabaseAdmin.from).toHaveBeenCalledWith('tenants');
    expect(supabaseAdmin.from).toHaveBeenCalledWith('campaigns');
  });

  it('should list consolidated usage reports correctly', async () => {
    app.addHook('preValidation', async (req: any) => {
      req.role = 'GUILDS_ADMIN';
      req.userId = 'guilds_admin_999';
    });

    vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [
          {
            tenant_id: 'tenant_1',
            llm_cost_cents: 1200,
            whatsapp_cost_cents: 300,
            google_maps_cost_cents: 100,
            tenant: {
              id: 'tenant_1',
              name: 'Giovane MetLife',
              mrr_cents: 15000,
              plan: 'STANDARD',
            },
          },
        ],
        error: null,
      }),
    }) as any);

    const response = await app.inject({
      method: 'GET',
      url: '/usage/consolidated',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].total_costs_cents).toBe(1600);
    expect(body.data[0].margin_cents).toBe(13400); // 15000 - 1600
  });
});
