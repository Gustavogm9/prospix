import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('consulta de impacto de templates', () => {
  it('não executa SQL construído com parâmetros da URL', () => {
    const route = readFileSync(
      resolve(process.cwd(), 'src/app/api/admin/templates/[id]/impact/route.ts'),
      'utf8',
    );

    expect(route).not.toContain("rpc('exec_sql'");
    expect(route).not.toContain("cloned_from_template_id = '${id}'");
  });
});
