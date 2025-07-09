-- Create the 'tracks' table to store unique song metadata
create table if not exists public.tracks (
  id uuid primary key default gen_random_uuid(),
  spotify_track_id text not null unique,
  name text not null,
  artist text not null,
  album text,
  duration_ms integer,
  popularity integer,
  spotify_url text,
 genre text,
 release_year integer,
 created_at timestamptz default now()
);

-- Create the 'suggested_tracks' table to log song suggestions
create table if not exists public.suggested_tracks (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id),
  track_id uuid not null references public.tracks(id),
  count integer not null default 1,
  first_suggested_at timestamptz default now(),
  last_suggested_at timestamptz default now(),
  unique (profile_id, track_id)
);

-- Function to handle logging a track suggestion
create or replace function public.log_track_suggestion(
  p_album_name text,
  p_artist_name text,
  p_duration_ms int,
  p_genre text,
  p_popularity int,
  p_profile_id uuid,
  p_release_year integer,
  p_spotify_track_id text,
  p_spotify_url text,
  p_track_name text
)
returns void as $$
declare
  v_track_id uuid;
begin
  -- Step 1: Find or create the track in the 'tracks' table.
  -- The 'on conflict' clause ensures that if the track already exists, we do nothing.
  insert into public.tracks (spotify_track_id, name, artist, album, duration_ms, popularity, spotify_url, genre, release_year)
  values (p_spotify_track_id, p_track_name, p_artist_name, p_album_name, p_duration_ms, p_popularity, p_spotify_url, p_genre, p_release_year)
  on conflict (spotify_track_id) do nothing;

  -- Get the ID of the track (whether it was newly inserted or already exists).
  select id into v_track_id from public.tracks where spotify_track_id = p_spotify_track_id;

  -- Step 2: If a profile_id is provided, upsert the suggestion into the 'suggested_tracks' table.
  if p_profile_id is not null then
    insert into public.suggested_tracks (profile_id, track_id, count, first_suggested_at, last_suggested_at)
    values (p_profile_id, v_track_id, 1, now(), now())
    on conflict (profile_id, track_id) do update
    set
      count = suggested_tracks.count + 1,
      last_suggested_at = now();
  end if;
end;
$$ language plpgsql volatile security definer;