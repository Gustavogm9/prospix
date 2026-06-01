-- =============================================================================
-- Prospix · Seed existing users into Supabase Auth
-- =============================================================================
-- This script creates Supabase Auth entries for all existing users in the
-- public.users table. Each user gets:
--   - A Supabase Auth account with email + default password "Prospix2025!"
--   - app_metadata: { tenant_id, role } for RLS
--   - user_metadata: { name }
--   - mustChangePassword flag set in public.users.preferences
--
-- Run this ONCE after enabling Supabase Auth.
-- Users will be forced to change password on first login.
-- =============================================================================

-- Step 1: Insert users into auth.users
-- Note: This uses Supabase's internal auth schema directly.
-- The password is bcrypt-hashed "Prospix2025!"
-- In production, use the Supabase Admin API instead of direct SQL.

DO $$
DECLARE
  r RECORD;
  auth_uid uuid;
BEGIN
  FOR r IN SELECT id, email, name, role, tenant_id FROM public.users WHERE email IS NOT NULL
  LOOP
    -- Check if auth user already exists
    SELECT id INTO auth_uid FROM auth.users WHERE email = r.email;
    
    IF auth_uid IS NULL THEN
      -- Create auth user via auth.users insert
      INSERT INTO auth.users (
        id,
        instance_id,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        aud,
        role,
        created_at,
        updated_at
      ) VALUES (
        r.id,  -- Reuse the same UUID from public.users
        '00000000-0000-0000-0000-000000000000',
        r.email,
        crypt('Prospix2025!', gen_salt('bf')),  -- bcrypt hash
        now(),
        jsonb_build_object('tenant_id', r.tenant_id, 'role', r.role),
        jsonb_build_object('name', r.name),
        'authenticated',
        'authenticated',
        now(),
        now()
      );
      
      -- Also create identity record
      INSERT INTO auth.identities (
        id,
        user_id,
        provider_id,
        provider,
        identity_data,
        last_sign_in_at,
        created_at,
        updated_at
      ) VALUES (
        r.id,
        r.id,
        r.email,
        'email',
        jsonb_build_object('sub', r.id::text, 'email', r.email),
        now(),
        now(),
        now()
      );
      
      RAISE NOTICE 'Created auth user for: % (role: %)', r.email, r.role;
    ELSE
      -- Update existing auth user's app_metadata
      UPDATE auth.users SET
        raw_app_meta_data = jsonb_build_object('tenant_id', r.tenant_id, 'role', r.role),
        raw_user_meta_data = jsonb_build_object('name', r.name)
      WHERE id = auth_uid;
      
      RAISE NOTICE 'Updated auth metadata for: %', r.email;
    END IF;
  END LOOP;
END $$;

-- Step 2: Set mustChangePassword flag for all users
UPDATE public.users
SET preferences = COALESCE(preferences, '{}'::jsonb) || '{"mustChangePassword": true}'::jsonb
WHERE email IS NOT NULL;
