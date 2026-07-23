-- Allows the G25 recovery state to be persisted in the canonical WhatsApp
-- Guardian status table. Additive contract change for the status check only.

BEGIN;

ALTER TABLE public.whatsapp_guardian_status
  DROP CONSTRAINT IF EXISTS whatsapp_guardian_status_status_check;

ALTER TABLE public.whatsapp_guardian_status
  ADD CONSTRAINT whatsapp_guardian_status_status_check
  CHECK (
    status::TEXT IN (
      'COLD',
      'RECOVERY',
      'NORMAL',
      'HIGH_LOAD',
      'COOLDOWN',
      'PAUSED',
      'SUSPENDED'
    )
  );

COMMENT ON CONSTRAINT whatsapp_guardian_status_status_check
  ON public.whatsapp_guardian_status
  IS 'Allows canonical WhatsApp Guardian statuses, including RECOVERY for G25 safe reconnection realignment.';

COMMIT;
