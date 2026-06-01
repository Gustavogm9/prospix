import { describe, it, expect } from 'vitest';
import { BaseWorker } from '../../src/workers/_base-worker.js';
import { Job } from 'bullmq';

class TestConcreteWorker extends BaseWorker<{ tenant_id: string; trace_id: string; message: string }, string> {
  name = 'test-concrete-worker';
  concurrency = 1;

  async process(job: Job<{ tenant_id: string; trace_id: string; message: string }>): Promise<string> {
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

  it('should run process() and return the result on success', async () => {
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
  });

  it('should propagate errors from process()', async () => {
    class BadWorker extends BaseWorker<{ tenant_id: string; trace_id: string }, never> {
      name = 'bad-worker';
      concurrency = 1;
      async process(_job: Job<{ tenant_id: string; trace_id: string }>): Promise<never> {
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
  });
});
