#!/usr/bin/env node
/**
 * verify-openapi.mjs
 *
 * Regenera o arquivo openapi.generated.ts num temp file e compara com o checked-in.
 * Falha (exit 1) se houver drift — sinal de que alguem mudou OpenAPI sem rodar `pnpm gen:openapi`.
 *
 * Usado no CI · resolve AUD-P2-016 ("shared-types nao e gerado nem validado contra OpenAPI").
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PACKAGE_ROOT = resolve(__dirname, '..');
const OPENAPI_SOURCE = resolve(PACKAGE_ROOT, '../../docs/api/openapi.yaml');
const COMMITTED = resolve(PACKAGE_ROOT, 'src/openapi.generated.ts');
const TEMP_OUTPUT = resolve(PACKAGE_ROOT, '.openapi.generated.tmp.ts');

if (!existsSync(OPENAPI_SOURCE)) {
  console.error(`[verify-openapi] OpenAPI source nao encontrado em ${OPENAPI_SOURCE}`);
  process.exit(2);
}

if (!existsSync(COMMITTED)) {
  console.error(
    `[verify-openapi] arquivo gerado nao existe em ${COMMITTED}.\n` +
      `Rode: pnpm --filter @prospix/shared-types gen:openapi`,
  );
  process.exit(1);
}

// Regenera num temp file (NAO sobrescreve o commitado)
const cli = resolve(PACKAGE_ROOT, 'node_modules/.bin/openapi-typescript');
const cliExists = existsSync(cli);
const cmd = cliExists ? cli : 'npx';
const args = cliExists
  ? [OPENAPI_SOURCE, '-o', TEMP_OUTPUT, '--immutable', '--root-types']
  : ['openapi-typescript', OPENAPI_SOURCE, '-o', TEMP_OUTPUT, '--immutable', '--root-types'];

const result = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });

if (result.status !== 0) {
  console.error('[verify-openapi] falha ao regenerar openapi.generated.ts');
  process.exit(result.status ?? 1);
}

const committed = readFileSync(COMMITTED, 'utf8').replace(/\r\n/g, '\n');
const regenerated = readFileSync(TEMP_OUTPUT, 'utf8').replace(/\r\n/g, '\n');

// Cleanup temp
try {
  unlinkSync(TEMP_OUTPUT);
} catch {
  /* noop */
}

if (committed.trim() === regenerated.trim()) {
  console.log('[verify-openapi] OK · openapi.generated.ts esta sincronizado com docs/api/openapi.yaml');
  process.exit(0);
}

console.error(
  '\n[verify-openapi] DRIFT DETECTADO\n' +
    'openapi.generated.ts esta dessincronizado com docs/api/openapi.yaml.\n\n' +
    'Reproduza local:\n' +
    '  pnpm --filter @prospix/shared-types gen:openapi\n' +
    '  git add packages/shared-types/src/openapi.generated.ts\n' +
    '  git commit -m "chore: regenera openapi.generated.ts"\n',
);

// Mostra preview do diff (primeiras 30 linhas) sem expor tudo
const committedLines = committed.split('\n');
const regeneratedLines = regenerated.split('\n');
const max = Math.max(committedLines.length, regeneratedLines.length);
let shown = 0;
for (let i = 0; i < max && shown < 30; i += 1) {
  if (committedLines[i] !== regeneratedLines[i]) {
    console.error(`  line ${i + 1}:`);
    console.error(`    - committed:   ${committedLines[i] ?? '<EOF>'}`);
    console.error(`    + regenerated: ${regeneratedLines[i] ?? '<EOF>'}`);
    shown += 1;
  }
}
if (shown === 30) {
  console.error('  ... (truncado)');
}

process.exit(1);
