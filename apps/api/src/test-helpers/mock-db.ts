import { vi } from 'vitest';

/**
 * Creates a mock Supabase client (dbAdmin) with a chainable fluent API.
 * 
 * Usage in tests:
 * ```ts
 * import { createMockDbAdmin, mockDbResult } from '../test-helpers/mock-db.js';
 * 
 * const { dbAdmin, mockFrom } = createMockDbAdmin();
 * vi.mock('../lib/db.js', () => ({ dbAdmin }));
 * 
 * // To set a return value for a specific chain:
 * mockFrom.mockReturnResult({ data: { id: '1' }, error: null });
 * ```
 */

type MockChainResult = { data: any; error: any; count?: number | null };

export function createChainableMock(defaultResult: MockChainResult = { data: null, error: null }) {
  let _result: MockChainResult = { ...defaultResult };

  const chain: any = {};

  const methods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
    'is', 'in', 'not', 'or', 'ilike', 'like',
    'order', 'limit', 'range', 'single', 'maybeSingle',
    'match', 'contains', 'containedBy', 'textSearch',
    'filter', 'csv',
  ];

  // Make the chain itself a thenable (so await resolves it)
  chain.then = (resolve: any, reject?: any) => {
    try {
      resolve(_result);
    } catch (err) {
      if (reject) reject(err);
    }
    return chain;
  };

  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }

  // Allow setting result for the chain
  chain._setResult = (result: MockChainResult) => {
    _result = result;
  };

  return chain;
}

export function createMockDbAdmin() {
  const chains: Map<string, any> = new Map();
  let defaultChain = createChainableMock();

  const from = vi.fn((tableName: string) => {
    if (chains.has(tableName)) {
      return chains.get(tableName);
    }
    return defaultChain;
  });

  const rpc = vi.fn().mockReturnValue(createChainableMock());

  const dbAdmin = { from, rpc };

  return {
    dbAdmin,
    mockFrom: from,
    /**
     * Set the result for any table (default chain).
     */
    setDefaultResult: (result: MockChainResult) => {
      defaultChain._setResult(result);
    },
    /**
     * Register a specific chain for a table with a preset result.
     */
    setTableResult: (tableName: string, result: MockChainResult) => {
      const chain = createChainableMock(result);
      chains.set(tableName, chain);
      return chain;
    },
    /**
     * Get or create a chain for a specific table.
     */
    getTableChain: (tableName: string) => {
      if (!chains.has(tableName)) {
        chains.set(tableName, createChainableMock());
      }
      return chains.get(tableName);
    },
    /**
     * Reset all mocks.
     */
    reset: () => {
      chains.clear();
      defaultChain = createChainableMock();
      from.mockClear();
    },
  };
}

/**
 * Helper to make a mock result object.
 */
export function mockDbResult(data: any, error: any = null, count: number | null = null): MockChainResult {
  return { data, error, count };
}
