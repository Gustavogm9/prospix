import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { logger } from './logger.js';
import { tenantContextStorage } from './tenant-context-storage.js';

declare global {
  var prisma: PrismaClient | undefined;
}

// Global symbol to prevent recursive loops in Prisma Extensions during transaction wrapping
const TRANSACTION_RLS_ACTIVE = Symbol('TransactionRlsActive');

const basePrisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  datasources: {
    db: {
      url: env.DATABASE_URL,
    },
  },
});

// We wrap the base client with query extensions to auto-inject PostgreSQL RLS session parameters
export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const store = tenantContextStorage.getStore();
        
        // 1. If RLS bypass is active, there is no active tenant, or this query is already running inside an active wrapped transaction, execute normally
        if (store?.bypassRls || !store?.tenantId || (args as any)[TRANSACTION_RLS_ACTIVE]) {
          return query(args);
        }

        // 2. Otherwise, wrap the single database query in an interactive transaction ($transaction)
        // to guarantee that the session set_config setting and the query execute over the EXACT SAME pooled connection.
        const transactionalArgs = {
          ...args,
          [TRANSACTION_RLS_ACTIVE]: true, // Mark args to bypass RLS wrapping in nested calls inside the transaction block
        };

        return basePrisma.$transaction(async (tx) => {
          // A. Inject the context tenant ID into the PostgreSQL transaction scope
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${store.tenantId}, true)`;
          
          if (store.userId) {
            // B. Inject the user ID if available
            await tx.$executeRaw`SELECT set_config('app.user_id', ${store.userId}, true)`;
          }

          // C. Re-route the intercepted model operation through the transaction client (tx)
          const transactionModel = (tx as any)[model];
          const transactionOperation = transactionModel[operation];
          
          return transactionOperation(transactionalArgs);
        });
      },
    },
  },
});

if (env.NODE_ENV !== 'production') {
  globalThis.prisma = basePrisma as any;
}

// Log Database Connection Status
basePrisma.$connect()
  .then(() => {
    logger.info('🔌 Database connected successfully via Prisma');
  })
  .catch((err) => {
    logger.error({ err }, '❌ Database connection failed via Prisma');
  });
