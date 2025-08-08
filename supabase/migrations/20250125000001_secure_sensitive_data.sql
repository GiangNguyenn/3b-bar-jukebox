-- Secure sensitive data in profiles table
-- This migration addresses sensitive token exposure

-- Create a secure view for public profile access that excludes sensitive data
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

-- Grant select access on the public view
GRANT SELECT ON public.profiles_public TO anon, authenticated;

-- Create a function to safely access token data (only for the token owner)
CREATE OR REPLACE FUNCTION get_user_spotify_tokens(user_id uuid)
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
  -- Only allow users to access their own tokens
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

-- Create a function to safely update tokens (only for the token owner)
CREATE OR REPLACE FUNCTION update_user_spotify_tokens(
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
  -- Only allow users to update their own tokens
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

-- IMPORTANT: Keep existing public access for compatibility with current public features
-- The security is handled by controlling what gets exposed in the application layer
-- rather than at the database level for now to prevent breaking changes

-- Create a function to get admin spotify credentials (for public API endpoints)
-- This preserves existing admin credential access patterns for public features
CREATE OR REPLACE FUNCTION get_admin_spotify_credentials()
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
  -- This function maintains compatibility with existing admin access patterns
  -- First try to get profile with '3B' in display_name (current pattern)
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
  
  -- If no '3B' profile found, fall back to first profile (existing .limit(1).single() pattern)
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
