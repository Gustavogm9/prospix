import './use-restricted-db.js';
import '../../src/config/env.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { SEED_TENANTS } from '@prospix/mocks';

const prisma = new PrismaClient();
let isDbConnected = true;
const requireDbEvidence = process.env.AUDIT_REQUIRE_DB === '1' || process.env.CI === 'true';

describe('PostgreSQL Row-Level Security (RLS) Multi-Tenant Isolation', () => {
  beforeAll(async () => {
    try {
      await prisma.$connect();
      // Execute a trivial query to confirm connection works
      await prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      const message = '[DATABASE OFFLINE] Row-Level Security integration tests require PostgreSQL on localhost:5432.';
      if (requireDbEvidence) {
        throw new Error(message);
      }

      console.warn(`\n⚠️  ${message} Tests skipped because AUDIT_REQUIRE_DB is not enabled.`);
      isDbConnected = false;
    }
  });

  afterAll(async () => {
    if (isDbConnected) {
      try {
        await prisma.$disconnect();
      } catch (err) {
        // Suppress disconnection errors if already failed
      }
    }
  });

  it('should return 0 rows when current_setting app.tenant_id is empty/not set', async (context) => {
    if (!isDbConnected) {
      context.skip();
      return;
    }
    // In interactive transaction, set_config with is_local=true applies to the transaction block
    const leads = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT set_config('app.tenant_id', '', true)");
      return tx.lead.findMany();
    });

    expect(leads).toBeDefined();
    expect(leads.length).toBe(0);
  });

  it('should return only Tenant A rows when app.tenant_id is set to Tenant A ID', async (context) => {
    if (!isDbConnected) {
      context.skip();
      return;
    }
    const tenantAId = SEED_TENANTS.A.id;
    
    const leads = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${tenantAId}', true)`);
      return tx.lead.findMany();
    });

    expect(leads).toBeDefined();
    expect(leads.length).toBeGreaterThan(0);
    
    // Every single returned lead MUST belong to Tenant A
    leads.forEach((lead) => {
      expect(lead.tenantId).toBe(tenantAId);
    });
  });

  it('should return only Tenant B rows when app.tenant_id is set to Tenant B ID', async (context) => {
    if (!isDbConnected) {
      context.skip();
      return;
    }
    const tenantBId = SEED_TENANTS.B.id;
    
    const leads = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${tenantBId}', true)`);
      return tx.lead.findMany();
    });

    expect(leads).toBeDefined();
    expect(leads.length).toBeGreaterThan(0);
    
    // Every single returned lead MUST belong to Tenant B
    leads.forEach((lead) => {
      expect(lead.tenantId).toBe(tenantBId);
    });
  });

  it('should prevent writing a Lead to Tenant B when context is set to Tenant A', async (context) => {
    if (!isDbConnected) {
      context.skip();
      return;
    }
    const tenantAId = SEED_TENANTS.A.id;
    const tenantBId = SEED_TENANTS.B.id;

    // Try to create a lead under Tenant B while using Tenant A's connection context
    // RLS policy checks tenant_id = current_tenant_id() on insert.
    // If it mismatches, it blocks it (with a violation or throws an error or fails constraint).
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${tenantAId}', true)`);
        
        return tx.lead.create({
          data: {
            tenantId: tenantBId, // Mismatch with active context tenantAId
            name: 'Malicious Cross Tenant Lead',
            whatsapp: '+5511999990099',
            source: 'MANUAL',
          },
        });
      })
    ).rejects.toThrow();
  });
});
