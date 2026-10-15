import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('contrato de configuração de produção', () => {
  it('não usa segredo padrão no cron', () => {
    const route = read('src/app/api/notifications/daily-summary/route.ts');
    expect(route).not.toContain("process.env.CRON_SECRET ||");
    expect(route).toContain('if (!cronSecret || !isValidCronAuthorization');
  });

  it('valida variáveis críticas no build da hospedagem', () => {
    const config = read('next.config.mjs');
    expect(config).toContain("process.env.VERCEL_ENV === 'production'");
    expect(config).toContain("'SUPABASE_SERVICE_ROLE_KEY'");
    expect(config).toContain("'SECRETS_ENCRYPTION_KEY'");
    expect(config).toContain("'CRON_SECRET'");
    expect(config).toContain('NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY');
  });

  it('o cliente administrativo exige configuração real', () => {
    const adminClient = read('src/app/api/_lib/supabase-admin.ts');
    expect(adminClient).toContain("requiredServerEnv('SUPABASE_SERVICE_ROLE_KEY')");
    expect(adminClient).not.toContain('process.env.SUPABASE_SERVICE_ROLE_KEY!');
  });
});
