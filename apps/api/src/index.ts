import fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
// @fastify/jwt REMOVED — JWT verification now handled by Supabase Auth
import rateLimit from '@fastify/rate-limit';

import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { dbAdmin } from './lib/db.js';
import { redis } from './lib/redis.js';
import { initAlertSinks } from './lib/alert-sink.js';

import { tenantContext } from './middlewares/tenant-context.js';
import { idempotencyPlugin } from './middlewares/idempotency.js';

import { authRoutes } from './routes/auth/index.js';
import { adminRoutes } from './routes/admin/index.js';
import { tenantRoutes } from './routes/tenant/index.js';
import { webhookRoutes } from './routes/webhooks/index.js';
import { evolutionWebhookRoutes } from './routes/webhooks/evolution.js';
import { sseRoutes } from './routes/sse.js';

const isProduction = env.NODE_ENV === 'production' || process.env.NODE_ENV === 'production';

const productionAllowedOrigins = Array.from(new Set([env.APP_URL, env.ADMIN_URL, env.LANDING_URL].filter(Boolean)));

function getPublicErrorMessage(error: any, statusCode: number): string {
  if (!isProduction) {
    return error.message || 'An unexpected error occurred.';
  }

  if (statusCode === 400) {
    return 'Invalid request.';
  }

  if (statusCode === 401) {
    return 'Authentication required.';
  }

  if (statusCode === 403) {
    return 'Access denied.';
  }

  if (statusCode === 404) {
    return 'Resource not found.';
  }

  return 'An unexpected error occurred. Please contact support.';
}

// Instantiate Fastify
const app = fastify({
  logger: false, // Disables standard Pino; we use our custom Pino logger
  trustProxy: true,
});

// Configure custom logger hook to log incoming requests nicely
app.addHook('onRequest', (request, _reply, done) => {
  logger.info({ method: request.method, url: request.url, ip: request.ip }, '📥 Request received');
  done();
});

app.addHook('onResponse', (request, reply, done) => {
  logger.info(
    { method: request.method, url: request.url, statusCode: reply.statusCode, duration_ms: reply.elapsedTime },
    '📤 Response sent'
  );
  done();
});

// Bootstrap Function
async function bootstrap() {
  logger.info('🚀 Starting Prospix Core API bootstrap...');

  // 0. Initialize alert sinks (Sentry/Slack) · config-time · no-op if unset
  initAlertSinks();

  // 1. Register security and utility plugins
  await app.register(cors, {
    origin: isProduction ? productionAllowedOrigins : '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id', 'X-Idempotency-Key'],
  });

  await app.register(helmet, {
    contentSecurityPolicy: isProduction,
  });

  // Rate Limit: 100 requests per minute by default per IP
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
  });

  // 2. Tenant Context preHandler hook (Supabase JWT verification happens inside)
  await app.register(idempotencyPlugin);

  app.addHook('preHandler', async (request, reply) => {
    return tenantContext(request, reply);
  });

  // 4. Global Error Handler
  app.setErrorHandler((err, request, reply) => {
    const error = err as any;
    logger.error({ err: error, url: request.url }, '💥 Unhandled route error');

    if (error.validation) {
      return reply.code(400).send({
        error: 'Validation Error',
        message: isProduction ? 'Invalid request payload.' : error.message,
        ...(isProduction ? {} : { details: error.validation }),
      });
    }

    if (error.statusCode === 429) {
      return reply.code(429).send({
        error: 'Rate Limited',
        message: 'Too many requests. Please try again later.',
      });
    }

    const statusCode = error.statusCode || 500;

    return reply.code(statusCode).send({
      error: statusCode === 500 ? 'Internal Error' : 'Error',
      message: getPublicErrorMessage(error, statusCode),
    });
  });

  // 5. Liveness / Readiness Health Check Routes
  app.get('/health', async (_req, reply) => {
    return reply.code(200).send({ status: 'ok' });
  });

  app.get('/ready', async (_req, reply) => {
    try {
      // Check database connection via Supabase
      const { error: dbError } = await dbAdmin.from('tenants').select('id').limit(1);
      if (dbError) throw new Error(`DB check failed: ${dbError.message}`);
      
      // Check redis connection
      const redisStatus = await redis.ping();
      if (redisStatus !== 'PONG') {
        throw new Error('Redis ping failed');
      }

      return reply.code(200).send({
        status: 'ready',
        checks: {
          db: 'ok',
          redis: 'ok',
        },
      });
    } catch (err) {
      logger.error({ err }, '🔴 Readiness check failed');
      return reply.code(503).send({
        status: 'not_ready',
        checks: {
          db: 'fail',
          redis: 'fail',
        },
      });
    }
  });

  // 6. Register Domain Routes
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(authRoutes, { prefix: '/v1/auth' });
  await app.register(adminRoutes, { prefix: '/admin' });
  await app.register(adminRoutes, { prefix: '/v1/admin' });
  await app.register(tenantRoutes, { prefix: '/v1/tenant' });
  await app.register(webhookRoutes, { prefix: '/v1/webhooks' });
  await app.register(evolutionWebhookRoutes, { prefix: '/v1/webhooks/evolution' });
  await app.register(evolutionWebhookRoutes, { prefix: '/webhooks/evolution' });
  await app.register(sseRoutes, { prefix: '/v1/sse' });

  // 7. Start Server
  if (process.env.NODE_ENV !== 'test') {
    try {
      const port = env.PORT;
      const address = await app.listen({ port, host: '0.0.0.0' });
      logger.info(`✨ Prospix API is fully loaded and running at: ${address}`);
    } catch (err) {
      logger.error({ err }, '❌ Fastify failed to start');
      process.exit(1);
    }
  }
}

// Execute bootstrap
bootstrap();

export { app };
export default app;
