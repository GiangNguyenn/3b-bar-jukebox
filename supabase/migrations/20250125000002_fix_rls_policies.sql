-- Fix RLS policies to resolve API endpoint errors
-- This migration focuses on enabling RLS while keeping public functionality working
-- We'll secure subscription data (the main concern) while keeping other tables permissive

-- 1. Profiles table - allow all access for admin credentials and user management
DROP POLICY IF EXISTS "Allow profile access" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile on signup" ON public.profiles;
DROP POLICY IF EXISTS "Allow all profile access" ON public.profiles;

CREATE POLICY "Allow all profile operations" ON public.profiles FOR ALL USING (true);

-- 2. Tracks table - allow all access for public functionality
DROP POLICY IF EXISTS "Allow track access" ON public.tracks;
DROP POLICY IF EXISTS "Allow track insert" ON public.tracks;
DROP POLICY IF EXISTS "Allow all track access" ON public.tracks;

CREATE POLICY "Allow all track operations" ON public.tracks FOR ALL USING (true);

-- 3. Jukebox queue table - allow all access for public functionality
DROP POLICY IF EXISTS "Allow queue access" ON public.jukebox_queue;
DROP POLICY IF EXISTS "Authenticated users can manage queue" ON public.jukebox_queue;
DROP POLICY IF EXISTS "Public read access to queue" ON public.jukebox_queue;
DROP POLICY IF EXISTS "Allow all operations on jukebox_queue" ON public.jukebox_queue;

CREATE POLICY "Allow all queue operations" ON public.jukebox_queue FOR ALL USING (true);

-- 4. Suggested tracks table - allow all access for now
DROP POLICY IF EXISTS "Users can manage their own suggestions" ON public.suggested_tracks;
DROP POLICY IF EXISTS "Allow all suggested track access" ON public.suggested_tracks;

CREATE POLICY "Allow all suggested track operations" ON public.suggested_tracks FOR ALL USING (true);

-- 5. Playlists table - allow all access for now
DROP POLICY IF EXISTS "Users can manage their own playlists" ON public.playlists;
DROP POLICY IF EXISTS "Allow all playlist access" ON public.playlists;

CREATE POLICY "Allow all playlist operations" ON public.playlists FOR ALL USING (true);

-- 6. Branding settings - allow all access for public branding
DROP POLICY IF EXISTS "Users can manage their own branding" ON public.branding_settings;
DROP POLICY IF EXISTS "Public read access to branding settings" ON public.branding_settings;

CREATE POLICY "Allow all branding operations" ON public.branding_settings FOR ALL USING (true);

-- 7. Subscriptions - KEEP RESTRICTIVE (this is our main security goal)
-- Users can only access their own subscription data
DROP POLICY IF EXISTS "Users can view their own subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Users can update their own subscriptions" ON public.subscriptions;  
DROP POLICY IF EXISTS "Service can insert subscriptions" ON public.subscriptions;

-- Secure subscription policies
CREATE POLICY "Users can view own subscriptions" ON public.subscriptions
  FOR SELECT USING (
    profile_id IN (
      SELECT id FROM public.profiles WHERE auth.uid() = id
    )
  );

CREATE POLICY "Users can update own subscriptions" ON public.subscriptions
  FOR UPDATE USING (
    profile_id IN (
      SELECT id FROM public.profiles WHERE auth.uid() = id
    )
  );

-- Allow service-level inserts for webhooks (no auth required for webhook endpoints)
CREATE POLICY "Allow subscription inserts" ON public.subscriptions
  FOR INSERT WITH CHECK (true);
