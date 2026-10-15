import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';

function validateProductionEnvironment() {
  if (process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Chave de serviço exposta em variável NEXT_PUBLIC.');
  }

  if (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY === process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error('A chave pública não pode ser igual à chave de serviço.');
  }

  const shouldValidateEnvironment =
    process.env.VERCEL_ENV === 'production' ||
    process.env.VALIDATE_PRODUCTION_ENV === 'true';
  if (!shouldValidateEnvironment) return;

  const requiredVariables = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_APP_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SECRETS_ENCRYPTION_KEY',
    'CRON_SECRET',
  ];
  const missing = requiredVariables.filter((name) => !process.env[name]?.trim());

  if (missing.length > 0) {
    throw new Error(`Configuração de produção incompleta: ${missing.join(', ')}`);
  }

  const appUrl = new URL(process.env.NEXT_PUBLIC_APP_URL);
  if (appUrl.protocol !== 'https:') {
    throw new Error('NEXT_PUBLIC_APP_URL precisa usar HTTPS em produção.');
  }
}

validateProductionEnvironment();

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline'${isProduction ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  isProduction ? 'upgrade-insecure-requests' : '',
].filter(Boolean).join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  ...(isProduction
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Prevent a stray user-level package-lock.json from becoming the tracing root.
  outputFileTracingRoot: path.resolve(appDir, '../..'),
  // Transpile workspace packages
  transpilePackages: ['@prospix/ui', '@prospix/shared-types'],
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
  // Only lint the app directory (skip legacy src/pages/ during migration)
  eslint: {
    ignoreDuringBuilds: true,
    dirs: ['src/app', 'src/components', 'src/hooks', 'src/layout', 'src/lib', 'src/store'],
  },
  webpack: (config) => {
    // @prospix/ui uses .js extensions in imports (e.g. './lib/cn.js')
    // but actual files are .ts/.tsx. This tells webpack to try .ts/.tsx
    // when a .js import can't be found.
    config.resolve.extensionAlias = {
      '.js': ['.js', '.ts', '.tsx'],
      '.jsx': ['.jsx', '.tsx'],
    };
    return config;
  },
};

export default nextConfig;
