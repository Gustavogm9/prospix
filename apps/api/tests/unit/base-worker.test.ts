import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseWorker } from '../../src/workers/_base-worker.js';
import { prisma } from '../../src/lib/prisma.js';
import { Job } from 'bullmq';

// Mock prisma executeRaw
vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    $executeRaw: vi.fn().mockResolvedValue(1),
  },
}));

class TestConcreteWorker extends BaseWorker<{ tenant_id: string; trace_id: string; message: string }, string> {
  name = 'test-concrete-worker';
  concurrency = 1;

  async process(job: Job<{ tenant_id: string; trace_id: string; message: string }>): Promise<string> {
    return `processed: ${job.data.message}`;
  }
}

describe('BaseWorker Isolation & Context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw an error immediately if tenant_id is missing from job data', async () => {
    const worker = new TestConcreteWorker();
    const mockJob = {
      id: 'job_123',
      data: {
        trace_id: 'trace_abc',
        message: 'hello',
      },
    } as unknown as Job;

    await expect(worker.run(mockJob)).rejects.toThrow('Missing tenant_id in job payload');
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('should set the PostgreSQL RLS context, call process, and then reset context on success', async () => {
    const worker = new TestConcreteWorker();
    const mockJob = {
      id: 'job_123',
      timestamp: Date.now(),
      data: {
        tenant_id: 'tenant-1111',
        trace_id: 'trace_abc',
        message: 'hello',
      },
    } as unknown as Job;

    const result = await worker.run(mockJob);

    expect(result).toBe('processed: hello');
    
    // First query sets tenant_id context
    expect(prisma.$executeRaw).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining([expect.stringContaining("SELECT set_config('app.tenant_id',")]),
      'tenant-1111'
    );
    
    // Final block resets tenant_id context
    expect(prisma.$executeRaw).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([expect.stringContaining("SELECT set_config('app.tenant_id',")]),
    );
  });

  it('should reset PostgreSQL RLS context even when process throws an error', async () => {
    class BadWorker extends BaseWorker<{ tenant_id: string; trace_id: string }, never> {
      name = 'bad-worker';
      concurrency = 1;
      async process(): Promise<never> {
        throw new Error('Processing failed');
      }
    }

    const worker = new BadWorker();
    const mockJob = {
      id: 'job_456',
      timestamp: Date.now(),
      data: {
        tenant_id: 'tenant-2222',
        trace_id: 'trace_xyz',
      },
    } as unknown as Job;

    await expect(worker.run(mockJob)).rejects.toThrow('Processing failed');
    
    // RLS context must still be reset
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(prisma.$executeRaw).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.stringContaining("SELECT set_config('app.tenant_id',")])
    );
  });
});
