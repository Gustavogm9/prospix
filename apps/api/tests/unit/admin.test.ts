import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import { adminRoutes } from '../../src/routes/admin/index.js';
import { prisma } from '../../src/lib/prisma.js';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    $executeRaw: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    tenant: {
      findUnique: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    tenantSecret: {
      create: vi.fn(),
    },
    tenantAIConfig: {
      create: vi.fn(),
    },
    tenantInvitation: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    campaign: {
      updateMany: vi.fn(),
    },
    tenantUsage: {
      findMany: vi.fn(),
    },
    tenantBilling: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    scriptTemplate: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn((fn) => fn(prisma)),
  },
}));

vi.mock('../../src/services/invitation-service.js', () => ({
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

    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);

    const mockTenant = {
      id: 'tenant_xyz',
      name: 'Roberta Prudential',
      slug: 'roberta-prudential',
      plan: 'STANDARD',
      status: 'ONBOARDING',
      mrrCents: 15000,
    };
    vi.mocked(prisma.tenant.create).mockResolvedValue(mockTenant as any);

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
    expect(prisma.tenant.create).toHaveBeenCalled();
    expect(prisma.tenantSecret.create).toHaveBeenCalled();
    expect(prisma.tenantAIConfig.create).toHaveBeenCalled();
  });

  it('should suspend tenant and pause active campaigns successfully', async () => {
    app.addHook('preValidation', async (req: any) => {
      req.role = 'GUILDS_ADMIN';
      req.userId = 'guilds_admin_999';
    });

    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: 'tenant_xyz',
      name: 'Roberta Prudential',
      status: 'ACTIVE',
    } as any);

    const response = await app.inject({
      method: 'POST',
      url: '/tenants/tenant_xyz/suspend',
    });

    expect(response.statusCode).toBe(200);
    expect(prisma.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tenant_xyz' },
        data: { status: 'SUSPENDED' },
      })
    );
    expect(prisma.campaign.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant_xyz', status: 'ACTIVE' },
        data: { status: 'PAUSED' },
      })
    );
  });

  it('should list consolidated usage reports correctly', async () => {
    app.addHook('preValidation', async (req: any) => {
      req.role = 'GUILDS_ADMIN';
      req.userId = 'guilds_admin_999';
    });

    vi.mocked(prisma.tenantUsage.findMany).mockResolvedValue([
      {
        tenantId: 'tenant_1',
        llmCostCents: 1200,
        whatsappCostCents: 300,
        googleMapsCostCents: 100,
        tenant: {
          id: 'tenant_1',
          name: 'Giovane MetLife',
          mrrCents: 15000,
          plan: 'STANDARD',
        },
      },
    ] as any);

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
