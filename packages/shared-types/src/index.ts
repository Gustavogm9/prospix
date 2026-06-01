/**
 * @prospix/shared-types
 *
 * Tipos compartilhados entre todas as apps do monorepo.
 * Fontes da verdade:
 *  - ./enums — enums standalone (ORM-agnostic)
 *  - ./api — tipos derivados do OpenAPI (request/response)
 *  - ./domain — tipos de domínio
 */

export * from './enums.js';
export * from './api.js';
export * from './domain.js';
