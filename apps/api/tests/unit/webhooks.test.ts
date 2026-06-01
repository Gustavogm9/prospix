import { describe, it, expect, vi, beforeEach } from 'vitest';
import { app } from '../../src/index.js';
import { supabaseAdmin } from '../../src/lib/supabase.js';

// Mock Supabase
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
    },
  };
});

// Mock Redis
vi.mock('../../src/lib/redis.js', () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock('../../src/lib/queue.js', () => ({
  getTenantQueueName: vi.fn((t, w) => `queue:${t}:${w}`),
  createTenantQueue: vi.fn(() => ({
    add: vi.fn().mockResolvedValue({}),
  })),
}));

describe('Webhook Routes', () => {
  const mockTenantId = 'tenant-wh-1234';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /webhooks/billing', () => {
    it('should validate Asaas webhook signature and process payment', async () => {
      const payload = {
        event: 'PAYMENT_RECEIVED',
        payment: {
          id: 'pay_1234567890',
          customer: 'cust_asaas_1',
          value: 150.0,
          status: 'RECEIVED',
          externalReference: `billing:${mockTenantId}:2026-05`,
          billingType: 'PIX',
        },
      };

      // Mock billing + tenant lookup
      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        if (table === 'tenant_billing') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'billing-1',
                tenant_id: mockTenantId,
                status: 'PENDING',
                total_cents: 15000,
                external_invoice_id: 'pay_1234567890',
              },
              error: null,
            }),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'billing-1',
                tenant_id: mockTenantId,
                status: 'PENDING',
                total_cents: 15000,
                external_invoice_id: 'pay_1234567890',
              },
              error: null,
            }),
            update: vi.fn().mockReturnThis(),
          } as any;
        }
        if (table === 'tenants') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: mockTenantId, status: 'SUSPENDED', name: 'Webhook Tenant' },
              error: null,
            }),
            update: vi.fn().mockReturnThis(),
          } as any;
        }
        if (table === 'audit_log') {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: {}, error: null }),
          } as any;
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      });

      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/billing',
        headers: {
          'asaas-access-token': process.env.ASAAS_WEBHOOK_TOKEN || 'test-webhook-token',
          'content-type': 'application/json',
        },
        payload,
      });

      expect(res.statusCode).toBe(200);
      expect(supabaseAdmin.from).toHaveBeenCalledWith('tenant_billing');
    });

    it('should reject webhook with invalid or missing signature', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/billing',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          event: 'PAYMENT_RECEIVED',
          payment: { id: 'pay_bad' },
        },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /webhooks/evolution', () => {
    it('should process inbound WhatsApp message from Evolution API', async () => {
      const payload = {
        event: 'messages.upsert',
        instance: 'tenant_mock',
        data: {
          key: {
            remoteJid: '5517998877665@s.whatsapp.net',
            fromMe: false,
            id: 'wa-msg-001',
          },
          messageType: 'conversation',
          message: {
            conversation: 'Olá, gostaria de saber mais',
          },
          pushName: 'Roberto',
          messageTimestamp: Date.now(),
        },
      };

      // Mock tenant secret lookup → find tenant by Evolution instance name
      vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
        if (table === 'tenant_secrets') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                tenant_id: mockTenantId,
                evolution_instance_name: 'tenant_mock',
                evolution_webhook_secret: 'secret-123',
              },
              error: null,
            }),
          } as any;
        }
        if (table === 'leads') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'lead-1',
                tenant_id: mockTenantId,
                whatsapp: '5517998877665',
                name: 'Roberto',
              },
              error: null,
            }),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'lead-1',
                tenant_id: mockTenantId,
                whatsapp: '5517998877665',
                name: 'Roberto',
              },
              error: null,
            }),
          } as any;
        }
        if (table === 'conversations') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'conv-1',
                tenant_id: mockTenantId,
                lead_id: 'lead-1',
                status: 'ACTIVE',
              },
              error: null,
            }),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'conv-1',
                tenant_id: mockTenantId,
                lead_id: 'lead-1',
                status: 'ACTIVE',
              },
              error: null,
            }),
          } as any;
        }
        if (table === 'messages') {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'msg-1' },
              error: null,
            }),
          } as any;
        }
        if (table === 'optouts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          } as any;
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          insert: vi.fn().mockReturnThis(),
        } as any;
      });

      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/evolution',
        headers: {
          'x-evolution-secret': 'secret-123',
          'content-type': 'application/json',
        },
        payload,
      });

      expect(res.statusCode).toBe(200);
      expect(supabaseAdmin.from).toHaveBeenCalledWith('messages');
    });

    it('should reject webhook with invalid Evolution secret', async () => {
      vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      }) as any);

      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/evolution',
        headers: {
          'x-evolution-secret': 'wrong-secret',
          'content-type': 'application/json',
        },
        payload: {
          event: 'messages.upsert',
          instance: 'unknown_instance',
          data: {
            key: { remoteJid: '551799999999@s.whatsapp.net', fromMe: false, id: 'wa-bad' },
            messageType: 'conversation',
            message: { conversation: 'test' },
          },
        },
      });

      expect(res.statusCode).toBe(401);
    });
  });
});
