/**
 * Real-time event hook using Supabase Realtime channels.
 *
 * Subscribes to PostgreSQL changes on `messages` and `conversations` tables
 * scoped to the current tenant.
 *
 * Usage:
 *   useRealtimeEvents(tenantId, {
 *     onMessageCreated: (payload) => { ... },
 *     onConversationUpdated: (payload) => { ... },
 *   });
 */
import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface RealtimeCallbacks {
  onMessageCreated?: (payload: Record<string, unknown>) => void;
  onMessageUpdated?: (payload: Record<string, unknown>) => void;
  onConversationCreated?: (payload: Record<string, unknown>) => void;
  onConversationUpdated?: (payload: Record<string, unknown>) => void;
}

export function useRealtimeEvents(
  tenantId: string | null | undefined,
  callbacks: RealtimeCallbacks,
) {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!tenantId) return;

    let messagesChannel: RealtimeChannel | null = null;
    let conversationsChannel: RealtimeChannel | null = null;

    // ── Subscribe to messages table changes ──
    messagesChannel = supabase
      .channel(`messages:tenant:${tenantId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          callbacksRef.current.onMessageCreated?.(payload.new as Record<string, unknown>);
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          callbacksRef.current.onMessageUpdated?.(payload.new as Record<string, unknown>);
        },
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn('[Realtime] Messages channel error — will auto-reconnect');
        }
      });

    // ── Subscribe to conversations table changes ──
    conversationsChannel = supabase
      .channel(`conversations:tenant:${tenantId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'conversations',
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          callbacksRef.current.onConversationCreated?.(payload.new as Record<string, unknown>);
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversations',
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          callbacksRef.current.onConversationUpdated?.(payload.new as Record<string, unknown>);
        },
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn('[Realtime] Conversations channel error — will auto-reconnect');
        }
      });

    return () => {
      if (messagesChannel) {
        supabase.removeChannel(messagesChannel);
      }
      if (conversationsChannel) {
        supabase.removeChannel(conversationsChannel);
      }
    };
  }, [tenantId]);
}
