'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { apiFetch } from '@/lib/api-fetch';
import {
  buildOperationalStatusView,
  type OperationalStatusResponse,
  type OperationalStatusView,
} from '@/lib/operational-status';

type UseOperationalStatusOptions = {
  enabled?: boolean;
  pollMs?: number;
};

export type OperationalStatusContextValue = {
  data: OperationalStatusResponse | null;
  view: OperationalStatusView;
  isLoading: boolean;
  error: string | null;
  fetchedAt: string | null;
  refresh: (silent?: boolean) => Promise<void>;
};

const OperationalStatusContext = createContext<OperationalStatusContextValue | null>(null);

export function useOperationalStatus(options: UseOperationalStatusOptions = {}): OperationalStatusContextValue {
  const { enabled = true, pollMs = 60_000 } = options;
  const [data, setData] = useState<OperationalStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(enabled);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async (silent = false) => {
    if (!enabled) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!silent) setIsLoading(true);

    try {
      const response = await apiFetch('/api/integrations/whatsapp/status');
      const json = await response.json().catch(() => ({}));
      if (requestId !== requestIdRef.current) return;
      if (!response.ok) {
        throw new Error(json?.message || json?.error || 'Falha ao carregar status operacional.');
      }
      setData(json as OperationalStatusResponse);
      setError(null);
      setFetchedAt(new Date().toISOString());
    } catch (err: unknown) {
      if (requestId !== requestIdRef.current) return;
      const message = err instanceof Error
        ? err.message || 'Falha ao carregar status operacional.'
        : 'Falha ao carregar status operacional.';
      setError(message);
      setData(null);
      setFetchedAt(new Date().toISOString());
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    refresh(false);
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled || pollMs <= 0) return;
    const interval = window.setInterval(() => {
      refresh(true);
    }, pollMs);
    return () => window.clearInterval(interval);
  }, [enabled, pollMs, refresh]);

  const view = useMemo(() => buildOperationalStatusView(data, error), [data, error]);

  return useMemo(() => ({
    data,
    view,
    isLoading,
    error,
    fetchedAt,
    refresh,
  }), [data, view, isLoading, error, fetchedAt, refresh]);
}

export function OperationalStatusProvider({
  value,
  children,
}: {
  value: OperationalStatusContextValue;
  children: ReactNode;
}) {
  return (
    <OperationalStatusContext.Provider value={value}>
      {children}
    </OperationalStatusContext.Provider>
  );
}

export function useOperationalStatusContext(): OperationalStatusContextValue | null {
  return useContext(OperationalStatusContext);
}
