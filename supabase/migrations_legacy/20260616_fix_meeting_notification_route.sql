-- ============================================================
-- 20260616_fix_meeting_notification_route.sql
-- Fixes the route for meeting scheduled notification from '/minha-agenda' to '/agenda'
-- ============================================================

CREATE OR REPLACE FUNCTION fn_notify_meeting_scheduled() RETURNS TRIGGER AS $$
DECLARE
  v_lead_name TEXT;
  v_scheduled TEXT;
BEGIN
  SELECT COALESCE(l.name, l.whatsapp, 'Lead') INTO v_lead_name FROM leads l WHERE l.id = NEW.lead_id;
  v_scheduled := TO_CHAR(NEW.scheduled_for AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI');

  PERFORM fn_create_notification(
    NEW.tenant_id, 'meeting_scheduled',
    '📅 Reunião agendada com ' || v_lead_name,
    'Agendada para ' || v_scheduled || ' (' || COALESCE(NEW.duration_minutes || 'min', '30min') || ')',
    '/agenda',
    jsonb_build_object('meeting_id', NEW.id, 'lead_id', NEW.lead_id, 'scheduled_for', NEW.scheduled_for)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
