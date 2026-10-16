import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const migration = readFileSync(
  resolve(repositoryRoot, 'supabase', 'migrations', '20261016180000_commercial_knowledge_rag.sql'),
  'utf8',
);
const webhook = readFileSync(
  resolve(repositoryRoot, 'supabase', 'functions', 'webhook-evolution', 'index.ts'),
  'utf8',
);

describe('commercial RAG security contract', () => {
  it('enforces tenant isolation and owner-only writes', () => {
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain("current_user_role()) = 'OWNER'");
    expect(migration).toContain('tenant_id = (SELECT public.current_tenant_id())');
    expect(migration).not.toMatch(/commercial_knowledge_[\s\S]{0,180}USING\s*\(\s*true\s*\)/i);
  });

  it('hardens the retrieval function and returns approved records only', () => {
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("chunks.status = 'APPROVED'");
    expect(migration).toContain('chunks.active = TRUE');
    expect(migration).toContain('LEAST(3');
    expect(migration).toContain("v_jwt_role <> 'service_role'");
    expect(migration).toContain('commercial knowledge script access denied');
  });

  it('does not fetch reference URLs and audits only source identifiers', () => {
    expect(webhook).toContain('legacyDocumentsToKnowledge');
    expect(webhook).toContain('knowledge_sources');
    expect(webhook).not.toContain('Use as informações contidas nos links abaixo');
    expect(webhook).not.toContain('Tenho uma brecha na Segunda');
    expect(webhook).not.toContain('É exatamente por isso que eu estou te chamando');
  });
});
