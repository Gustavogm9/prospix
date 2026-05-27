/**
 * Real-time event hook using Server-Sent Events (SSE).
 *
 * Replaces Supabase Realtime subscriptions with a direct SSE connection
 * to the API's /v1/sse/events endpoint.
 *
 * Usage:
 *   useRealtimeEvents(tenantId, {
 *     onMessageCreated: (payload) => { ... },
 *     onConversationUpdated: (payload) => { ... },
 *   });
 */
import { useEffect, useRef } from 'react';
import { useAuthStore } from '../store/auth-store';

interface RealtimeCallbacks {
  onMessageCreated?: (payload: Record<string, unknown>) => void;
  onMessageUpdated?: (payload: Record<string, unknown>) => void;
  onConversationCreated?: (payload: Record<string, unknown>) => void;
  onConversationUpdated?: (payload: Record<string, unknown>) => void;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export function useRealtimeEvents(
  tenantId: string | null | undefined,
  callbacks: RealtimeCallbacks,
) {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const { accessToken } = useAuthStore();

  useEffect(() => {
    if (!tenantId) return;

    let controller: AbortController | null = new AbortController();
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;
    const maxRetry = 10;

    async function connect() {
      if (!controller) return;

      try {
        const url = `${API_URL}/v1/sse/events?tenantId=${tenantId}`;
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'text/event-stream',
          },
        });

        if (!response.ok) {
          throw new Error(`SSE connection failed: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder();
        let buffer = '';

        retryCount = 0; // Reset on successful connection

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let currentEvent = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              const data = line.slice(6);
              try {
                const payload = JSON.parse(data);
                switch (currentEvent) {
                  case 'message:created':
                    callbacksRef.current.onMessageCreated?.(payload);
                    break;
                  case 'message:updated':
                    callbacksRef.current.onMessageUpdated?.(payload);
                    break;
                  case 'conversation:created':
                    callbacksRef.current.onConversationCreated?.(payload);
                    break;
                  case 'conversation:updated':
                    callbacksRef.current.onConversationUpdated?.(payload);
                    break;
                }
                currentEvent = '';
              } catch {
                // Not valid JSON — could be heartbeat or partial data
              }
            }
          }
        }
      } catch (err: unknown) {
        if ((err as Error)?.name === 'AbortError') return;
        console.warn('[SSE] Connection lost, retrying...', err);
      }

      // Reconnect with exponential backoff
      if (controller && retryCount < maxRetry) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
        retryCount++;
        retryTimeout = setTimeout(connect, delay);
      }
    }

    connect();

    return () => {
      controller?.abort();
      controller = null;
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [tenantId, accessToken]);
}
