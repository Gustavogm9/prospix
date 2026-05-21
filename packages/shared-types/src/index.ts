/**
 * @prospix/shared-types
 *
 * Tipos compartilhados entre todas as apps do monorepo.
 * Fontes da verdade:
 *  - ./prisma — re-exporta tipos gerados pelo Prisma Client
 *  - ./api — tipos derivados do OpenAPI (request/response)
 */

export * from './prisma.js';
export * from './api.js';
export * from './domain.js';
