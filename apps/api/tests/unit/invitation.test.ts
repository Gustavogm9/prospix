import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateInvitationCode, createInvitation } from '../../src/services/invitation-service.js';
import { INVITATION_CODE_REGEX } from '@prospix/shared-types';
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
    },
  };
});

describe('Invitation Wizard Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should generate a code that matches regex ^PRSPX-[A-Z0-9]{4}-[A-Z0-9]{4}$', () => {
    const code = generateInvitationCode();
    expect(code).toBeDefined();
    expect(INVITATION_CODE_REGEX.test(code)).toBe(true);
  });

  it('should successfully create an invitation if no active invitation exists', async () => {
    const tenantId = 'tenant_123';
    const createdBy = 'user_999';

    // Mock: findFirst (check active invitation) → returns null
    // Mock: findUnique (check code uniqueness) → returns null
    // Mock: create → returns new invitation
    const mockCreatedRecord = {
      id: 'inv_abc',
      code: 'PRSPX-AAAA-BBBB',
      tenant_id: tenantId,
      expires_at: new Date().toISOString(),
    };

    let callCount = 0;
    vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) => {
      callCount++;
      if (callCount <= 2) {
        // First two calls: check for existing invitation and code uniqueness
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        } as any;
      }
      // Third call: create the invitation
      return {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockCreatedRecord, error: null }),
      } as any;
    });

    const result = await createInvitation(tenantId, createdBy, 'Test note');
    
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('inv_abc');
      expect(result.value.code).toBe('PRSPX-AAAA-BBBB');
    }
    
    expect(supabaseAdmin.from).toHaveBeenCalledWith('tenant_invitations');
  });

  it('should fail to create invitation if tenant already has an active invitation', async () => {
    const tenantId = 'tenant_123';
    const createdBy = 'user_999';

    // Simulate an active invitation found
    vi.mocked(supabaseAdmin.from).mockImplementation((_table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'active_inv',
          code: 'PRSPX-XXXX-YYYY',
          tenant_id: tenantId,
          used_at: null,
          revoked_at: null,
          expires_at: new Date(Date.now() + 100000).toISOString(),
        },
        error: null,
      }),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: 'active_inv',
          code: 'PRSPX-XXXX-YYYY',
          tenant_id: tenantId,
          used_at: null,
          revoked_at: null,
          expires_at: new Date(Date.now() + 100000).toISOString(),
        },
        error: null,
      }),
      limit: vi.fn().mockResolvedValue({
        data: [{
          id: 'active_inv',
          code: 'PRSPX-XXXX-YYYY',
          tenant_id: tenantId,
          used_at: null,
          revoked_at: null,
          expires_at: new Date(Date.now() + 100000).toISOString(),
        }],
        error: null,
      }),
    }) as any);

    const result = await createInvitation(tenantId, createdBy);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toContain('active invitation');
    }
  });
});
