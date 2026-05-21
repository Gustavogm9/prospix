import fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';

import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';

import { tenantContext } from './middlewares/tenant-context.js';
import { idempotencyPlugin } from './middlewares/idempotency.js';

import { authRoutes } from './routes/auth/index.js';
import { adminRoutes } from './routes/admin/index.js';
import { tenantRoutes } from './routes/tenant/index.js';
import { webhookRoutes } from './routes/webhooks/index.js';
import { evolutionWebhookRoutes } from './routes/webhooks/evolution.js';

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

  // 1. Register security and utility plugins
  await app.register(cors, {
    origin: '*', // Customize in production
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id', 'X-Idempotency-Key'],
  });

  await app.register(helmet, {
    contentSecurityPolicy: env.NODE_ENV === 'production',
  });

  // Rate Limit: 100 requests per minute by default per IP
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
  });

  // 2. Register JWT Authentication (RS256)
  const privateKey = env.JWT_PRIVATE_KEY.replace(/\\n/g, '\n');
  const publicKey = env.JWT_PUBLIC_KEY.replace(/\\n/g, '\n');

  await app.register(jwt, {
    secret: {
      private: privateKey,
      public: publicKey,
    },
    sign: { algorithm: 'RS256', expiresIn: env.JWT_EXPIRES_IN },
    verify: { algorithms: ['RS256'] },
  });

  // 3. Register global Hooks and Middlewares
  // Idempotency plugin first (it checks and wraps the response)
  await app.register(idempotencyPlugin);
  
  // Tenant Context & RLS preHandler hook
  app.addHook('preHandler', tenantContext);

  // 4. Liveness / Readiness Health Check Routes
  app.get('/health', async (_req, reply) => {
    return reply.code(200).send({ status: 'ok' });
  });

  app.get('/ready', async (_req, reply) => {
    try {
      // Check database connection
      await prisma.$queryRaw`SELECT 1`;
      
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

  // 5. Register Domain Routes
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(adminRoutes, { prefix: '/admin' });
  await app.register(adminRoutes, { prefix: '/v1/admin' });
  await app.register(tenantRoutes, { prefix: '/v1/tenant' });
  await app.register(webhookRoutes, { prefix: '/v1/webhooks' });
  await app.register(evolutionWebhookRoutes, { prefix: '/v1/webhooks/evolution' });
  await app.register(evolutionWebhookRoutes, { prefix: '/webhooks/evolution' });

  // 6. Global Error Handler
  app.setErrorHandler((err, request, reply) => {
    const error = err as any;
    logger.error({ err: error, url: request.url }, '💥 Unhandled route error');

    if (error.validation) {
      return reply.code(400).send({
        error: 'Validation Error',
        message: error.message,
        details: error.validation,
      });
    }

    if (error.statusCode === 429) {
      return reply.code(429).send({
        error: 'Rate Limited',
        message: 'Too many requests. Please try again later.',
      });
    }

    return reply.code(error.statusCode || 500).send({
      error: 'Internal Error',
      message: error.message || 'An unexpected error occurred.',
    });
  });

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
