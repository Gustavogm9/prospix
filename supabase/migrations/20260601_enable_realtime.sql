-- ============================================================================
-- Enable Supabase Realtime for messages and conversations tables
-- ============================================================================
-- This migration adds the messages and conversations tables to the
-- supabase_realtime publication so that the frontend can subscribe to
-- INSERT/UPDATE events via Supabase Realtime (postgres_changes).
-- ============================================================================

-- First, check if the publication exists and add tables to it.
-- Supabase creates the 'supabase_realtime' publication automatically.

-- Add messages table to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

-- Add conversations table to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;

-- Optionally, also add leads for live updates on the funil/pipeline pages
ALTER PUBLICATION supabase_realtime ADD TABLE public.leads;

-- Add notifications for real-time notification badge updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
