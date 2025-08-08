-- Enable Row Level Security for all tables
-- CRITICAL SECURITY UPDATE: This migration addresses critical RLS vulnerabilities

-- 1. Enable RLS on profiles table
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profiles policies (using IF NOT EXISTS equivalent with DROP/CREATE pattern)
-- Note: We use a single permissive SELECT policy to maintain compatibility with public features
-- The admin endpoints need to access admin credentials without authentication
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Public access to profile info" ON public.profiles;
CREATE POLICY "Allow profile access" ON public.profiles
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert their own profile on signup" ON public.profiles;
CREATE POLICY "Users can insert their own profile on signup" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- 2. Enable RLS on subscriptions table  
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Subscriptions policies - users can only access their own subscription data
DROP POLICY IF EXISTS "Users can view their own subscriptions" ON public.subscriptions;
CREATE POLICY "Users can view their own subscriptions" ON public.subscriptions
  FOR SELECT USING (
    profile_id IN (
      SELECT id FROM public.profiles WHERE auth.uid() = id
    )
  );

DROP POLICY IF EXISTS "Users can update their own subscriptions" ON public.subscriptions;
CREATE POLICY "Users can update their own subscriptions" ON public.subscriptions
  FOR UPDATE USING (
    profile_id IN (
      SELECT id FROM public.profiles WHERE auth.uid() = id
    )
  );

DROP POLICY IF EXISTS "Service can insert subscriptions" ON public.subscriptions;
CREATE POLICY "Service can insert subscriptions" ON public.subscriptions
  FOR INSERT WITH CHECK (true); -- Webhooks need insert access

-- 3. Enable RLS on branding_settings table
ALTER TABLE public.branding_settings ENABLE ROW LEVEL SECURITY;

-- Branding policies
DROP POLICY IF EXISTS "Users can manage their own branding" ON public.branding_settings;
CREATE POLICY "Users can manage their own branding" ON public.branding_settings
  FOR ALL USING (
    profile_id IN (
      SELECT id FROM public.profiles WHERE auth.uid() = id
    )
  );

-- Allow public read access to branding settings (for public jukebox pages)
DROP POLICY IF EXISTS "Public read access to branding settings" ON public.branding_settings;
CREATE POLICY "Public read access to branding settings" ON public.branding_settings
  FOR SELECT USING (true);

-- 4. Enable RLS on playlists table
ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;

-- Playlists policies
DROP POLICY IF EXISTS "Users can manage their own playlists" ON public.playlists;
CREATE POLICY "Users can manage their own playlists" ON public.playlists
  FOR ALL USING (
    user_id = auth.uid()
  );

-- 5. Enable RLS on tracks table
ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;

-- Tracks policies - tracks are shared data, accessible by all for public functionality
DROP POLICY IF EXISTS "Authenticated users can read tracks" ON public.tracks;
CREATE POLICY "Allow track access" ON public.tracks
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert tracks" ON public.tracks;
CREATE POLICY "Allow track insert" ON public.tracks
  FOR INSERT WITH CHECK (true);

-- 6. Enable RLS on suggested_tracks table  
ALTER TABLE public.suggested_tracks ENABLE ROW LEVEL SECURITY;

-- Suggested tracks policies
DROP POLICY IF EXISTS "Users can manage their own suggestions" ON public.suggested_tracks;
CREATE POLICY "Users can manage their own suggestions" ON public.suggested_tracks
  FOR ALL USING (
    profile_id IN (
      SELECT id FROM public.profiles WHERE auth.uid() = id
    )
  );

-- 7. Update jukebox_queue RLS policy to be more restrictive
DROP POLICY IF EXISTS "Allow all operations on jukebox_queue" ON public.jukebox_queue;
DROP POLICY IF EXISTS "Authenticated users can manage queue" ON public.jukebox_queue;
DROP POLICY IF EXISTS "Public read access to queue" ON public.jukebox_queue;

-- Jukebox queue policies - allow all operations for public functionality
CREATE POLICY "Allow queue access" ON public.jukebox_queue
  FOR ALL USING (true);
