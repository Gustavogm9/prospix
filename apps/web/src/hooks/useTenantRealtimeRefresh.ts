import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

interface UseTenantRealtimeRefreshOptions {
  tenantId: string | null | undefined;
  tables: string[];
  onRefresh: () => void | Promise<void>;
  intervalMs?: number;
  debounceMs?: number;
}

export function useTenantRealtimeRefresh({
  tenantId,
  tables,
  onRefresh,
  intervalMs = 15000,
  debounceMs = 600,
}: UseTenantRealtimeRefreshOptions) {
  const refreshRef = useRef(onRefresh);
  const tablesRef = useRef(tables);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  refreshRef.current = onRefresh;
  tablesRef.current = tables;

  useEffect(() => {
    if (!tenantId) return;

    let disposed = false;
    let channel: RealtimeChannel | null = null;

    const runRefresh = () => {
      if (disposed) return;
      void refreshRef.current();
    };

    const scheduleRefresh = () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(runRefresh, debounceMs);
    };

    const interval = setInterval(runRefresh, intervalMs);

    const subscribe = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) {
        supabase.realtime.setAuth(data.session.access_token);
      }

      channel = supabase.channel(`tenant-dashboard-refresh:${tenantId}:${tablesRef.current.join(':')}`);
      for (const table of tablesRef.current) {
        channel.on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table,
            filter: `tenant_id=eq.${tenantId}`,
          },
          scheduleRefresh,
        );
      }
      channel.subscribe();
    };

    void subscribe().catch((error) => {
      console.warn('[Realtime] dashboard refresh subscription failed; polling remains active.', error);
    });

    return () => {
      disposed = true;
      clearInterval(interval);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [tenantId, intervalMs, debounceMs]);
}
