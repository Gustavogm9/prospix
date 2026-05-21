import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Carrega o .env apropriado se process.env não estiver totalmente preenchido
if (process.env.NODE_ENV === 'test') {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });
} else {
  dotenv.config();
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test', 'staging']).default('development'),
  PORT: z.coerce.number().default(3000),
  APP_URL: z.string().url().default('http://localhost:5173'),
  ADMIN_URL: z.string().url().default('http://localhost:5174'),
  LANDING_URL: z.string().url().default('http://localhost:3001'),
  API_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SHADOW_DATABASE_URL: z.string().optional(),
  DATABASE_POOL_MIN: z.coerce.number().default(5),
  DATABASE_POOL_MAX: z.coerce.number().default(50),

  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  REDIS_MAX_RETRIES: z.coerce.number().default(10),

  JWT_PRIVATE_KEY: z.string().min(1, 'JWT_PRIVATE_KEY is required'),
  JWT_PUBLIC_KEY: z.string().min(1, 'JWT_PUBLIC_KEY is required'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('30d'),
  MAGIC_LINK_TTL_SECONDS: z.coerce.number().default(600),

  SECRETS_ENCRYPTION_KEY: z.string().min(1, 'SECRETS_ENCRYPTION_KEY is required'),

  EVOLUTION_BASE_URL: z.string().url().default('https://evo.prospix.com.br'),
  EVOLUTION_GUILDS_INSTANCE: z.string().default('guilds_master'),
  EVOLUTION_GUILDS_API_KEY: z.string().min(1, 'EVOLUTION_GUILDS_API_KEY is required'),

  INVITATION_CODE_TTL_DAYS: z.coerce.number().default(14),
  INVITATION_CODE_PREFIX: z.string().default('PRSPX'),

  // Google Calendar integration
  GOOGLE_CLIENT_ID: z.string().default('mock-client-id'),
  GOOGLE_CLIENT_SECRET: z.string().default('mock-client-secret'),

  // Asaas integration
  ASAAS_API_KEY: z.string().default('mock-asaas-key'),
  ASAAS_BASE_URL: z.string().url().default('https://sandbox.asaas.com/v3'),
  ASAAS_WEBHOOK_SECRET: z.string().default('mock-asaas-webhook-secret'),

  // Resend integration
  RESEND_API_KEY: z.string().default('mock-resend-key'),
}).superRefine((data, ctx) => {
  if (data.NODE_ENV === 'production') {
    const mockCredentials = [
      { key: 'GOOGLE_CLIENT_ID', val: 'mock-client-id', name: 'Google Client ID' },
      { key: 'GOOGLE_CLIENT_SECRET', val: 'mock-client-secret', name: 'Google Client Secret' },
      { key: 'ASAAS_API_KEY', val: 'mock-asaas-key', name: 'Asaas API Key' },
      { key: 'ASAAS_WEBHOOK_SECRET', val: 'mock-asaas-webhook-secret', name: 'Asaas Webhook Secret' },
      { key: 'RESEND_API_KEY', val: 'mock-resend-key', name: 'Resend API Key' },
    ];

    for (const cred of mockCredentials) {
      if (data[cred.key as keyof typeof data] === cred.val) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `In production mode, mock API keys are not allowed. Please supply a real value for: ${cred.name}.`,
          path: [cred.key],
        });
      }
    }
  }
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('❌ Invalid environment variables:', JSON.stringify(_env.error.format(), null, 2));
  throw new Error('Invalid environment variables');
}

export const env = _env.data;

