import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateInvitationCode, createInvitation } from '../../src/services/invitation-service.js';
import { INVITATION_CODE_REGEX } from '@prospix/shared-types';
import { prisma } from '../../src/lib/prisma.js';

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    tenantInvitation: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

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
    
    vi.mocked(prisma.tenantInvitation.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.tenantInvitation.findUnique).mockResolvedValue(null);
    
    const mockCreatedRecord = {
      id: 'inv_abc',
      code: 'PRSPX-AAAA-BBBB',
      tenantId,
      expiresAt: new Date(),
    } as any;
    
    vi.mocked(prisma.tenantInvitation.create).mockResolvedValue(mockCreatedRecord);

    const result = await createInvitation(tenantId, createdBy, 'Test note');
    
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('inv_abc');
      expect(result.value.code).toBe('PRSPX-AAAA-BBBB');
    }
    
    expect(prisma.tenantInvitation.create).toHaveBeenCalled();
  });

  it('should fail to create invitation if tenant already has an active invitation', async () => {
    const tenantId = 'tenant_123';
    const createdBy = 'user_999';

    // Simulate an active invitation
    vi.mocked(prisma.tenantInvitation.findFirst).mockResolvedValue({
      id: 'active_inv',
      code: 'PRSPX-XXXX-YYYY',
      tenantId,
      usedAt: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 100000),
    } as any);

    const result = await createInvitation(tenantId, createdBy);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toContain('active invitation');
    }
    
    expect(prisma.tenantInvitation.create).not.toHaveBeenCalled();
  });
});
