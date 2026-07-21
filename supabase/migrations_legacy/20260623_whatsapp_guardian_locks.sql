-- Function to try acquiring advisory lock via Supabase RPC
CREATE OR REPLACE FUNCTION public.try_advisory_lock(lock_id text)
RETURNS boolean AS $$
BEGIN
  RETURN pg_try_advisory_lock(hashtext(lock_id));
END;
$$ LANGUAGE plpgsql;

-- Function to try releasing advisory lock via Supabase RPC
CREATE OR REPLACE FUNCTION public.try_advisory_unlock(lock_id text)
RETURNS boolean AS $$
BEGIN
  RETURN pg_advisory_unlock(hashtext(lock_id));
END;
$$ LANGUAGE plpgsql;
