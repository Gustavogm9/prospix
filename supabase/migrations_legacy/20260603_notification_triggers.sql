-- ============================================================
-- 20260603_notification_triggers.sql
-- Creates database triggers for real-time notifications
-- ============================================================

-- 1. Helper: create notification for all tenant users (respecting preferences)
CREATE OR REPLACE FUNCTION fn_create_notification(
  p_tenant_id UUID,
  p_event_type TEXT,
  p_title TEXT,
  p_body TEXT,
  p_link TEXT DEFAULT NULL,
  p_data JSONB DEFAULT NULL
) RETURNS void AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT u.id AS user_id
    FROM users u
    WHERE u.tenant_id = p_tenant_id
      AND u.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM notification_preferences np
        WHERE np.user_id = u.id
          AND np.event_type = p_event_type
          AND np.enabled = false
      )
  LOOP
    INSERT INTO notifications (id, tenant_id, user_id, type, title, body, link, data, created_at)
    VALUES (gen_random_uuid(), p_tenant_id, r.user_id, p_event_type, p_title, p_body, p_link, p_data, NOW());
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 2. Trigger: Lead replied (inbound message)
CREATE OR REPLACE FUNCTION fn_notify_lead_replied() RETURNS TRIGGER AS $$
DECLARE
  v_lead_name TEXT;
  v_conv_tenant UUID;
BEGIN
  IF NEW.direction = 'INBOUND' THEN
    SELECT c.tenant_id, COALESCE(l.name, l.whatsapp, 'Lead')
    INTO v_conv_tenant, v_lead_name
    FROM conversations c LEFT JOIN leads l ON l.id = c.lead_id
    WHERE c.id = NEW.conversation_id;

    IF v_conv_tenant IS NOT NULL THEN
      PERFORM fn_create_notification(
        v_conv_tenant, 'lead_replied',
        '💬 ' || v_lead_name || ' respondeu',
        LEFT(NEW.content, 120),
        '/conversas?id=' || NEW.conversation_id,
        jsonb_build_object('conversation_id', NEW.conversation_id, 'message_id', NEW.id)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_lead_replied ON messages;
CREATE TRIGGER trg_notify_lead_replied
  AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION fn_notify_lead_replied();

-- 3. Trigger: Meeting scheduled
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
    '/minha-agenda',
    jsonb_build_object('meeting_id', NEW.id, 'lead_id', NEW.lead_id, 'scheduled_for', NEW.scheduled_for)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_meeting_scheduled ON meetings;
CREATE TRIGGER trg_notify_meeting_scheduled
  AFTER INSERT ON meetings FOR EACH ROW EXECUTE FUNCTION fn_notify_meeting_scheduled();

-- 4. Trigger: Lead callback request (intent-based)
CREATE OR REPLACE FUNCTION fn_notify_lead_callback() RETURNS TRIGGER AS $$
DECLARE
  v_lead_name TEXT;
  v_conv_tenant UUID;
BEGIN
  IF NEW.direction = 'INBOUND' AND NEW.intent_detected IN ('callback', 'call_request', 'want_call', 'speak_human', 'talk_to_human') THEN
    SELECT c.tenant_id, COALESCE(l.name, l.whatsapp, 'Lead')
    INTO v_conv_tenant, v_lead_name
    FROM conversations c LEFT JOIN leads l ON l.id = c.lead_id
    WHERE c.id = NEW.conversation_id;

    IF v_conv_tenant IS NOT NULL THEN
      PERFORM fn_create_notification(
        v_conv_tenant, 'lead_callback',
        '📞 ' || v_lead_name || ' pediu ligação',
        'O lead solicitou falar com você diretamente.',
        '/conversas?id=' || NEW.conversation_id,
        jsonb_build_object('conversation_id', NEW.conversation_id, 'message_id', NEW.id)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_lead_callback ON messages;
CREATE TRIGGER trg_notify_lead_callback
  AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION fn_notify_lead_callback();

-- 5. Trigger: Conversation escalated
CREATE OR REPLACE FUNCTION fn_notify_conversation_escalated() RETURNS TRIGGER AS $$
DECLARE
  v_lead_name TEXT;
BEGIN
  IF OLD.escalated_reason IS NULL AND NEW.escalated_reason IS NOT NULL THEN
    SELECT COALESCE(l.name, l.whatsapp, 'Lead') INTO v_lead_name FROM leads l WHERE l.id = NEW.lead_id;
    PERFORM fn_create_notification(
      NEW.tenant_id, 'lead_callback',
      '📞 ' || v_lead_name || ' precisa de atenção',
      'Motivo: ' || NEW.escalated_reason,
      '/conversas?id=' || NEW.id,
      jsonb_build_object('conversation_id', NEW.id, 'reason', NEW.escalated_reason)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_conversation_escalated ON conversations;
CREATE TRIGGER trg_notify_conversation_escalated
  AFTER UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION fn_notify_conversation_escalated();
