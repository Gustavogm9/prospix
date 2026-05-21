import pino from 'pino';
import { env } from '../config/env.js';

const isDev = env.NODE_ENV === 'development';

export const logger = pino({
  level: isDev ? 'debug' : 'info',
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-tenant-id"]',
      'password',
      'token',
      'secret',
      'whatsapp',
      'phone',
      'telephone',
      'number',
      '*.whatsapp',
      '*.phone',
      '*.number',
      '*.telephone',
      'req.body.whatsapp',
      'req.body.phone',
      'req.body.number'
    ],
    censor: '*** [PII REDACTED]',
  },
});

