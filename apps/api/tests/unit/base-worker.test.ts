import { describe, it, expect } from 'vitest';
import { BaseWorker } from '../../src/workers/_base-worker.js';
import { tenantContextStorage } from '../../src/lib/tenant-context-storage.js';
import { Job } from 'bullmq';

class TestConcreteWorker extends BaseWorker<{ tenant_id: string; trace_id: string; message: string }, string> {
  name = 'test-concrete-worker';
  concurrency = 1;

  async process(job: Job<{ tenant_id: string; trace_id: string; message: string }>): Promise<string> {
    // Assert that AsyncLocalStorage RLS context is set correctly during processing
    const store = tenantContextStorage.getStore();
    if (!store || store.tenantId !== job.data.tenant_id) {
      throw new Error('AsyncLocalStorage RLS context is not active in process()');
    }
    return `processed: ${job.data.message}`;
  }
}

describe('BaseWorker Isolation & Context', () => {
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
  });

  it('should run execution inside the tenantContextStorage context on success', async () => {
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
    
    // Assert store is cleared after worker execution
    expect(tenantContextStorage.getStore()).toBeUndefined();
  });

  it('should clear tenantContextStorage context even when process throws an error', async () => {
    class BadWorker extends BaseWorker<{ tenant_id: string; trace_id: string }, never> {
      name = 'bad-worker';
      concurrency = 1;
      async process(job: Job<{ tenant_id: string; trace_id: string }>): Promise<never> {
        const store = tenantContextStorage.getStore();
        if (!store || store.tenantId !== job.data.tenant_id) {
          throw new Error('Store inactive in error test');
        }
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
    
    // Assert store is cleared after worker execution failure
    expect(tenantContextStorage.getStore()).toBeUndefined();
  });
});
