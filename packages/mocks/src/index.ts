/**
 * @prospix/mocks
 *
 * Mocks de todas as integrações externas + seed de tenants fictícios.
 * Frente A implementa primeiro; outras frentes consomem em dev/test.
 *
 * Use com MSW (Mock Service Worker) nos testes e em apps/web em dev.
 */

export * from './evolution.js';
export * from './openai.js';
export * from './google-maps.js';
export * from './google-calendar.js';
export * from './asaas.js';
export * from './seed.js';
export * from './brasilapi.js';
