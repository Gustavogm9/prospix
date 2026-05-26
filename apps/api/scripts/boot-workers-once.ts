/**
 * Bootstrap workers + scheduler · script standalone para smoke do scheduler diário.
 * Sai depois de 8s, suficiente para inicializar workers + registrar scheduler.
 */
import { startWorkers } from '../src/workers/index.js';
import { redisConnection } from '../src/lib/redis.js';
import { prisma } from '../src/lib/prisma.js';

async function main() {
  console.log('booting workers...');
  await startWorkers();
  console.log('workers booted. waiting 4s para schedulers settle...');
  await new Promise((r) => setTimeout(r, 4000));
  console.log('terminando.');
  await prisma.$disconnect().catch(() => undefined);
  await redisConnection.quit().catch(() => undefined);
  process.exit(0);
}

main().catch(async (err) => {
  console.error('boot falhou:', err);
  await prisma.$disconnect().catch(() => undefined);
  await redisConnection.quit().catch(() => undefined);
  process.exit(1);
});
