import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { logger } from './logger.js';

declare global {
  var prisma: PrismaClient | undefined;
}

export const prisma = globalThis.prisma || new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  datasources: {
    db: {
      url: env.DATABASE_URL,
    },
  },
});

if (env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}

// Log Prisma connections
prisma.$connect()
  .then(() => {
    logger.info('🔌 Database connected successfully via Prisma');
  })
  .catch((err) => {
    logger.error({ err }, '❌ Database connection failed via Prisma');
  });
