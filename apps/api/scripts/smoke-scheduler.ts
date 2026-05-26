/**
 * Smoke: dispara alert-scan via queue (não apenas chamada direta) para validar worker pipeline.
 * Não inicializa workers · só enfileira e checa que o job entrou.
 */
import { Queue } from 'bullmq';
import { redisConnection } from '../src/lib/redis.js';
import { getTenantQueueName } from '../src/lib/queue.js';

async function main() {
  const queueName = getTenantQueueName('global', 'alert-scan');
  const queue = new Queue(queueName, { connection: redisConnection });

  try {
    const before = await queue.getJobCounts('waiting', 'active', 'completed', 'delayed', 'failed');
    console.log('queue antes:', before);

    const job = await queue.add('manual-smoke', { trace_id: 'smoke-test', run_all_tenants: true });
    console.log(`✓ job enfileirado · id=${job.id}`);

    const after = await queue.getJobCounts('waiting', 'active', 'completed', 'delayed', 'failed');
    console.log('queue após enqueue:', after);

    // Confirma scheduler diário registrado
    const schedulers = await queue.getJobSchedulers();
    console.log(`schedulers registrados (${schedulers.length}):`);
    for (const s of schedulers) {
      console.log(`   - id=${s.key} pattern=${s.pattern} tz=${s.tz ?? 'UTC'} next=${s.next ? new Date(s.next).toISOString() : 'n/a'}`);
    }

    console.log('\n✓ smoke scheduler OK');
  } finally {
    await queue.close();
    await redisConnection.quit().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error('smoke scheduler falhou:', err);
  process.exit(1);
});
