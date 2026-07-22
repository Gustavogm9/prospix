-- Prevent explicit campaign/script mismatches at the database boundary.
-- This keeps campaign configuration aligned even when writes bypass the UI.

BEGIN;

CREATE OR REPLACE FUNCTION public.validate_campaign_active_script_compatibility()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  script_record RECORD;
BEGIN
  IF NEW.active_script_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    scripts.id,
    scripts.tenant_id,
    scripts.name,
    scripts.status,
    scripts.category,
    scripts.target_profession
  INTO script_record
  FROM public.scripts scripts
  WHERE scripts.id = NEW.active_script_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign active_script_id references a script that does not exist.'
      USING ERRCODE = '23514';
  END IF;

  IF script_record.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'Campaign active_script_id must reference a script from the same tenant.'
      USING ERRCODE = '23514';
  END IF;

  IF script_record.status::TEXT <> 'ACTIVE' OR script_record.category::TEXT <> 'APPROACH' THEN
    RAISE EXCEPTION 'Campaign active_script_id must reference an active approach script.'
      USING ERRCODE = '23514';
  END IF;

  IF script_record.target_profession IS NOT NULL
     AND script_record.target_profession::TEXT <> NEW.profession::TEXT THEN
    RAISE EXCEPTION 'Campaign active_script_id target profession does not match campaign profession.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS campaigns_validate_active_script_compatibility ON public.campaigns;
CREATE TRIGGER campaigns_validate_active_script_compatibility
BEFORE INSERT OR UPDATE OF tenant_id, profession, active_script_id
ON public.campaigns
FOR EACH ROW
EXECUTE FUNCTION public.validate_campaign_active_script_compatibility();

COMMENT ON FUNCTION public.validate_campaign_active_script_compatibility() IS
  'Rejects explicit campaign active_script_id values that point to another tenant, inactive/non-approach scripts, or scripts for a different profession.';

COMMIT;
