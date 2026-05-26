/**
 * ESLint flat config (v9) raiz do monorepo.
 *
 * Cobre apps/* e packages/* TS + TSX.
 * Regras minimal recommended de typescript-eslint sem type-aware (fast).
 * react/react-hooks ficam para iteração futura quando plugins forem migrados.
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/build/**',
      '**/*.config.{js,mjs,cjs,ts}',
      '**/prisma/migrations/**',
      'apps/**/openapi.generated.ts',
      'packages/**/openapi.generated.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{tsx,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
    },
    rules: {
      // Não bloqueia o monorepo · iteração incremental
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-escape': 'warn',
      'no-prototype-builtins': 'off',
    },
  },
);
