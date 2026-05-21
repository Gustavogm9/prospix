import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // Required by BullMQ
  retryStrategy(times) {
    if (times > env.REDIS_MAX_RETRIES) {
      logger.error('❌ Redis reconnection max retries reached. Shutting down...');
      process.exit(1);
    }
    const delay = Math.min(times * 100, 3000);
    return delay;
  },
});

redis.on('connect', () => {
  logger.info('🔑 Redis connected successfully');
});

redis.on('error', (err) => {
  logger.error({ err }, '❌ Redis error occurred');
});

// For BullMQ connection options
export const redisConnection = redis;
