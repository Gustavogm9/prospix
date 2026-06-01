/**
 * Feature flags · runtime check com cache em memória de 30s.
 *
 * Resolução (override tenant-específico > global > default):
 *  1. FeatureFlag(key, tenantId) → usa enabled
 *  2. FeatureFlag(key, NULL) (global) → usa enabled
 *  3. Não existe nenhuma → retorna fallback (default false)
 *
 * Padrão de consumo (não usar JSON.parse / re-fetch por chamada):
 *   if (await isFeatureEnabled('evolution.outbound_disabled', tenantId)) {
 *     // pula envio externo
 *   }
 *
 * Cache é local ao processo. Atualização de flag pelo painel admin
 * invalida via `invalidateFeatureFlagCache(key)` (chamado pelos endpoints).
 */
import { dbAdmin } from './db.js';
import { logger } from './logger.js';

interface CacheEntry {
  enabled: boolean | null; // null = não definido (fallback)
  expiresAt: number;
}

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, CacheEntry>();

function cacheKey(key: string, tenantId: string | null | undefined): string {
  return `${key}::${tenantId ?? 'GLOBAL'}`;
}

export async function isFeatureEnabled(
  key: string,
  tenantId?: string | null,
  fallback = false,
): Promise<boolean> {
  const ck = cacheKey(key, tenantId ?? null);
  const cached = cache.get(ck);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.enabled ?? fallback;
  }

  try {
    let resolved: boolean | null = null;
    if (tenantId) {
      const { data: override } = await dbAdmin
        .from('feature_flags')
        .select('enabled')
        .eq('key', key)
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (override) resolved = override.enabled;
    }
    if (resolved === null) {
      const { data: global } = await dbAdmin
        .from('feature_flags')
        .select('enabled')
        .eq('key', key)
        .is('tenant_id', null)
        .maybeSingle();
      if (global) resolved = global.enabled;
    }

    cache.set(ck, { enabled: resolved, expiresAt: Date.now() + CACHE_TTL_MS });
    return resolved ?? fallback;
  } catch (err) {
    logger.warn({ err, key, tenantId }, 'feature-flags · lookup failed, returning fallback');
    return fallback;
  }
}

export function invalidateFeatureFlagCache(key?: string, tenantId?: string | null): void {
  if (key === undefined) {
    cache.clear();
    return;
  }
  if (tenantId === undefined) {
    // Invalida todas as entradas para esse key
    for (const k of cache.keys()) {
      if (k.startsWith(`${key}::`)) cache.delete(k);
    }
    return;
  }
  cache.delete(cacheKey(key, tenantId));
}

export function getFeatureFlagCacheSize(): number {
  return cache.size;
}
