import { AsyncLocalStorage } from 'async_hooks';

export interface TenantStorageContext {
  tenantId: string | null;
  userId?: string | null;
  bypassRls?: boolean;
}

export const tenantContextStorage = new AsyncLocalStorage<TenantStorageContext>();
