-- Migration: Add artist cache tables for DGS engine optimization
-- Purpose: Cache artist profiles, relationships, and top tracks to reduce Spotify API calls
-- These tables are populated lazily/on-demand as the game runs

-- 1. Store artist profiles (genres, popularity, follower count)
CREATE TABLE IF NOT EXISTS public.artists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_artist_id text NOT NULL UNIQUE,
  name text NOT NULL,
  genres text[], -- PostgreSQL array of genre strings
  popularity integer,
  follower_count integer,
  cached_at timestamptz DEFAULT now()
);

-- Indexes for fast lookups
CREATE INDEX idx_artists_spotify_id ON public.artists(spotify_artist_id);
CREATE INDEX idx_artists_genres_gin ON public.artists USING GIN(genres); -- Array search optimization

-- 2. Cache related artist relationships
-- Uses Spotify IDs directly (not FKs) for flexibility - can cache before we have full artist records
CREATE TABLE IF NOT EXISTS public.artist_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_spotify_artist_id text NOT NULL,
  related_spotify_artist_id text NOT NULL,
  cached_at timestamptz DEFAULT now(),
  UNIQUE(source_spotify_artist_id, related_spotify_artist_id)
);

-- Index for fast lookups by source artist
CREATE INDEX idx_relationships_source ON public.artist_relationships(source_spotify_artist_id);

-- 3. Cache top tracks per artist (rank 1-10)
-- Uses Spotify IDs directly for flexibility
CREATE TABLE IF NOT EXISTS public.artist_top_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_artist_id text NOT NULL,
  spotify_track_id text NOT NULL,
  rank integer NOT NULL CHECK (rank >= 1 AND rank <= 10),
  cached_at timestamptz DEFAULT now(),
  UNIQUE(spotify_artist_id, spotify_track_id)
);

-- Composite index for fast artist+rank queries
CREATE INDEX idx_top_tracks_artist_rank ON public.artist_top_tracks(spotify_artist_id, rank);

-- 4. Add indexes to existing tracks table for better query performance
CREATE INDEX IF NOT EXISTS idx_tracks_genre ON public.tracks(genre) WHERE genre IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tracks_popularity ON public.tracks(popularity);
CREATE INDEX IF NOT EXISTS idx_tracks_spotify_id ON public.tracks(spotify_track_id);

-- 5. Enable RLS (permissive for now - these are cache tables)
ALTER TABLE public.artists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artist_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artist_top_tracks ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users (cache tables are read-heavy)
CREATE POLICY "Allow all operations on artists" ON public.artists FOR ALL USING (true);
CREATE POLICY "Allow all operations on artist_relationships" ON public.artist_relationships FOR ALL USING (true);
CREATE POLICY "Allow all operations on artist_top_tracks" ON public.artist_top_tracks FOR ALL USING (true);

-- 6. Add comments for documentation
COMMENT ON TABLE public.artists IS 'Cache of Spotify artist profiles including genres and popularity. Populated on-demand by DGS engine.';
COMMENT ON TABLE public.artist_relationships IS 'Cache of related artist relationships. Populated when DGS engine discovers related artists.';
COMMENT ON TABLE public.artist_top_tracks IS 'Cache of top 10 tracks per artist. Populated when DGS engine fetches artist tracks.';

