-- Recreate profiles table from project usage, destroying existing table first
-- This migration:
-- 1) Drops dependent view/functions, then drops public.profiles CASCADE
-- 2) Recreates public.profiles with correct columns, constraints, and indexes
-- 3) Restores permissive RLS policy used by the app
-- 4) Recreates public view and helper functions
-- 5) Re-adds foreign keys in dependent tables that were dropped via CASCADE

-- 0) Drop dependent objects if they exist
DROP VIEW IF EXISTS public.profiles_public;
DROP FUNCTION IF EXISTS public.get_user_spotify_tokens(uuid);
DROP FUNCTION IF EXISTS public.update_user_spotify_tokens(uuid, text, text, bigint, text);
DROP FUNCTION IF EXISTS public.get_admin_spotify_credentials();

-- 1) Destroy current profiles table and dependencies
DROP TABLE IF EXISTS public.profiles CASCADE;

-- 2) Recreate profiles table
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  spotify_user_id text NOT NULL,
  display_name text NOT NULL,
  avatar_url text NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  spotify_access_token text NULL,
  spotify_refresh_token text NULL,
  spotify_token_expires_at bigint NULL,
  spotify_provider_id text NULL,
  spotify_product_type text NULL,
  is_premium boolean NULL DEFAULT false,
  premium_verified_at timestamptz NULL,
  subscription_id uuid NULL,

  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_spotify_user_id_key UNIQUE (spotify_user_id),
  CONSTRAINT profiles_display_name_key UNIQUE (display_name),

  CONSTRAINT profiles_id_fkey
    FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE,

  CONSTRAINT profiles_subscription_id_fkey
    FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS profiles_spotify_user_id_idx ON public.profiles (spotify_user_id);
CREATE INDEX IF NOT EXISTS profiles_display_name_idx ON public.profiles (display_name);
CREATE INDEX IF NOT EXISTS idx_profiles_is_premium ON public.profiles (is_premium);
CREATE INDEX IF NOT EXISTS idx_profiles_spotify_product_type ON public.profiles (spotify_product_type);
CREATE INDEX IF NOT EXISTS idx_profiles_premium_verified_at ON public.profiles (premium_verified_at);
CREATE INDEX IF NOT EXISTS profiles_subscription_id_idx ON public.profiles (subscription_id);

-- 3) RLS policy matching current app expectations
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all profile operations" ON public.profiles;
CREATE POLICY "Allow all profile operations" ON public.profiles FOR ALL USING (true);

-- 4) Recreate public view and helper functions
CREATE OR REPLACE VIEW public.profiles_public AS 
SELECT 
  id,
  created_at,
  updated_at,
  display_name,
  avatar_url,
  spotify_user_id,
  spotify_product_type,
  is_premium,
  premium_verified_at,
  subscription_id
FROM public.profiles;

GRANT SELECT ON public.profiles_public TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_user_spotify_tokens(user_id uuid)
RETURNS TABLE(
  spotify_access_token text,
  spotify_refresh_token text,
  spotify_token_expires_at bigint,
  spotify_provider_id text
) 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != user_id THEN
    RAISE EXCEPTION 'Access denied: You can only access your own tokens';
  END IF;
  RETURN QUERY
  SELECT 
    p.spotify_access_token,
    p.spotify_refresh_token,
    p.spotify_token_expires_at,
    p.spotify_provider_id
  FROM public.profiles p
  WHERE p.id = user_id AND p.id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.update_user_spotify_tokens(
  user_id uuid,
  access_token text DEFAULT NULL,
  refresh_token text DEFAULT NULL,
  expires_at bigint DEFAULT NULL,
  provider_id text DEFAULT NULL
)
RETURNS boolean
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  update_count integer;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != user_id THEN
    RAISE EXCEPTION 'Access denied: You can only update your own tokens';
  END IF;
  UPDATE public.profiles 
  SET 
    spotify_access_token = COALESCE(access_token, spotify_access_token),
    spotify_refresh_token = COALESCE(refresh_token, spotify_refresh_token),
    spotify_token_expires_at = COALESCE(expires_at, spotify_token_expires_at),
    spotify_provider_id = COALESCE(provider_id, spotify_provider_id),
    updated_at = timezone('utc'::text, now())
  WHERE id = user_id AND id = auth.uid();
  GET DIAGNOSTICS update_count = ROW_COUNT;
  RETURN update_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_spotify_credentials()
RETURNS TABLE(
  id uuid,
  spotify_access_token text,
  spotify_refresh_token text,
  spotify_token_expires_at bigint
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.spotify_access_token,
    p.spotify_refresh_token,
    p.spotify_token_expires_at
  FROM public.profiles p
  WHERE p.display_name ILIKE '%3B%'
  ORDER BY p.created_at
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT 
      p.id,
      p.spotify_access_token,
      p.spotify_refresh_token,
      p.spotify_token_expires_at
    FROM public.profiles p
    ORDER BY p.created_at
    LIMIT 1;
  END IF;
END;
$$;

-- 5) Re-add foreign keys in dependent tables (dropped by CASCADE)
-- Subscriptions: profile link
ALTER TABLE IF EXISTS public.subscriptions
  ADD CONSTRAINT subscriptions_profile_id_fkey
  FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Branding settings: profile link
ALTER TABLE IF EXISTS public.branding_settings
  ADD CONSTRAINT branding_settings_profile_id_fkey
  FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Suggested tracks: profile link
ALTER TABLE IF EXISTS public.suggested_tracks
  ADD CONSTRAINT suggested_tracks_profile_id_fkey
  FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Jukebox queue: profile link
ALTER TABLE IF EXISTS public.jukebox_queue
  ADD CONSTRAINT jukebox_queue_profile_id_fkey
  FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Align profiles subscription index with optimized version and add lookup index
DROP INDEX IF EXISTS profiles_subscription_id_idx;
CREATE INDEX IF NOT EXISTS idx_profiles_subscription_id 
  ON public.profiles (subscription_id) WHERE subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_subscription_lookup 
  ON public.profiles (id, subscription_id);

-- Recreate materialized view and related functions/triggers used by subscription queries
CREATE MATERIALIZED VIEW IF NOT EXISTS user_subscription_summary AS
SELECT 
  p.id as profile_id,
  p.display_name,
  s.id as subscription_id,
  s.plan_type,
  s.payment_type,
  s.status,
  s.current_period_start,
  s.current_period_end,
  s.stripe_subscription_id,
  s.stripe_customer_id,
  s.created_at as subscription_created_at,
  s.updated_at as subscription_updated_at
FROM public.profiles p
LEFT JOIN public.subscriptions s ON p.subscription_id = s.id
WHERE s.status = 'active' OR s.status IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_subscription_summary_profile 
  ON user_subscription_summary(profile_id);
CREATE INDEX IF NOT EXISTS idx_user_subscription_summary_plan 
  ON user_subscription_summary(profile_id, plan_type);

CREATE OR REPLACE FUNCTION refresh_user_subscription_summary()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW user_subscription_summary;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh_subscription_summary_trigger()
RETURNS trigger AS $$
BEGIN
  PERFORM refresh_user_subscription_summary();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_refresh_subscription_summary ON public.subscriptions;
CREATE TRIGGER trigger_refresh_subscription_summary
  AFTER INSERT OR UPDATE OR DELETE ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION refresh_subscription_summary_trigger();

DROP TRIGGER IF EXISTS trigger_refresh_subscription_summary_profiles ON public.profiles;
CREATE TRIGGER trigger_refresh_subscription_summary_profiles
  AFTER UPDATE OF subscription_id ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION refresh_subscription_summary_trigger();


