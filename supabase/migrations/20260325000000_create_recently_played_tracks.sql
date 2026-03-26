CREATE TABLE IF NOT EXISTS public.recently_played_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  spotify_track_id text NOT NULL,
  title text NOT NULL,
  artist text NOT NULL,
  played_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(profile_id, spotify_track_id)
);

CREATE INDEX idx_recently_played_profile_played
  ON public.recently_played_tracks(profile_id, played_at DESC);
