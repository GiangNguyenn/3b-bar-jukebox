# Supabase Database Schema

This document outlines the schema for the Supabase database used in this project.

## Tables

### `playlists`

```sql
create table public.playlists (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  spotify_playlist_id text not null,
  name text not null default '3B Saigon'::text,
  created_at timestamp with time zone not null default timezone ('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone ('utc'::text, now()),
  constraint playlists_pkey primary key (id),
  constraint playlists_user_id_spotify_playlist_id_key unique (user_id, spotify_playlist_id),
  constraint playlists_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists playlists_user_id_idx on public.playlists using btree (user_id) TABLESPACE pg_default;

create index IF not exists playlists_spotify_playlist_id_idx on public.playlists using btree (spotify_playlist_id) TABLESPACE pg_default;
```

### `profiles`

```sql
create table public.profiles (
  id uuid not null,
  spotify_user_id text not null,
  display_name text null,
  avatar_url text null,
  created_at timestamp with time zone not null default timezone ('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone ('utc'::text, now()),
  spotify_access_token text null,
  spotify_refresh_token text null,
  spotify_token_expires_at bigint null,
  spotify_provider_id text null,
  spotify_product_type text null,
  is_premium boolean null default false,
  premium_verified_at timestamp with time zone null,
  constraint profiles_pkey primary key (id),
  constraint profiles_spotify_user_id_key unique (spotify_user_id),
  constraint profiles_id_fkey foreign KEY (id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists profiles_spotify_user_id_idx on public.profiles using btree (spotify_user_id) TABLESPACE pg_default;

create index IF not exists idx_profiles_is_premium on public.profiles using btree (is_premium) TABLESPACE pg_default;

create index IF not exists idx_profiles_spotify_product_type on public.profiles using btree (spotify_product_type) TABLESPACE pg_default;

create index IF not exists idx_profiles_premium_verified_at on public.profiles using btree (premium_verified_at) TABLESPACE pg_default;
```

### `tracks`

```sql
-- Create the 'tracks' table to store Spotify track metadata
CREATE TABLE public.tracks (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    spotify_track_id text NOT NULL,
    name text NOT NULL,
    artist text NOT NULL,
    album text NOT NULL,
    genre text NULL,
    release_year integer NULL,
    duration_ms integer NOT NULL,
    popularity integer NOT NULL,
    spotify_url text NULL,
    created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT tracks_pkey PRIMARY KEY (id)
);

-- Add a unique constraint for spotify_track_id to prevent duplicate tracks
CREATE UNIQUE INDEX IF NOT EXISTS tracks_spotify_track_id_idx ON public.tracks (spotify_track_id);
```

### `suggested_tracks`

```sql
-- Create the 'suggested_tracks' table to track suggestions per profile per track
CREATE TABLE public.suggested_tracks (
    profile_id uuid NOT NULL,
    track_id uuid NOT NULL,
    count integer NOT NULL DEFAULT 1,
    first_suggested_at timestamp with time zone NOT NULL,
    last_suggested_at timestamp with time zone NOT NULL,
    CONSTRAINT suggested_tracks_pkey PRIMARY KEY (profile_id, track_id), -- Composite primary key
    CONSTRAINT suggested_tracks_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
    CONSTRAINT suggested_tracks_track_id_fkey FOREIGN KEY (track_id) REFERENCES public.tracks (id) ON DELETE CASCADE
);

-- Optional: Add indexes for foreign keys if they are frequently queried independently
CREATE INDEX IF NOT EXISTS suggested_tracks_profile_id_idx ON public.suggested_tracks (profile_id);
CREATE INDEX IF NOT EXISTS suggested_tracks_track_id_idx ON public.suggested_tracks (track_id);
```

### `jukebox_queue`

```sql
-- Create the 'jukebox_queue' table to manage real-time song queues
CREATE TABLE public.jukebox_queue (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL,
    track_id uuid NOT NULL,
    votes integer NOT NULL DEFAULT 0,
    queued_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT jukebox_queue_pkey PRIMARY KEY (id),
    CONSTRAINT jukebox_queue_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
    CONSTRAINT jukebox_queue_track_id_fkey FOREIGN KEY (track_id) REFERENCES public.tracks (id) ON DELETE CASCADE
);

-- Optional: Add indexes for efficient lookup and sorting
CREATE INDEX IF NOT EXISTS jukebox_queue_profile_id_idx ON public.jukebox_queue (profile_id);
CREATE INDEX IF NOT EXISTS jukebox_queue_track_id_idx ON public.jukebox_queue (track_id);
-- This index will be useful for ordering by votes for a specific profile's queue
CREATE INDEX IF NOT EXISTS jukebox_queue_profile_id_votes_queued_at_idx ON public.jukebox_queue (profile_id, votes DESC, queued_at ASC);
```

### `branding_settings`

```sql
-- Create the 'branding_settings' table to store custom branding configuration per profile
CREATE TABLE public.branding_settings (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL,

    -- Logo and Images
    logo_url text NULL,
    favicon_url text NULL,

    -- Text Elements
    venue_name text NULL DEFAULT '3B SAIGON JUKEBOX',
    subtitle text NULL,
    welcome_message text NULL,
    footer_text text NULL,

    -- Typography
    font_family text NULL DEFAULT 'Belgrano',
    font_size text NULL DEFAULT 'text-4xl',
    font_weight text NULL DEFAULT 'normal',
    text_color text NULL DEFAULT '#ffffff',

    -- Color Scheme
    primary_color text NULL DEFAULT '#C09A5E',
    secondary_color text NULL DEFAULT '#191414',
    background_color text NULL DEFAULT '#000000',
    accent_color_1 text NULL,
    accent_color_2 text NULL,
    accent_color_3 text NULL,

    -- Gradients
    gradient_type text NULL DEFAULT 'none', -- 'none', 'linear', 'radial'
    gradient_direction text NULL, -- 'to-b', 'to-r', 'to-br', etc.
    gradient_stops text NULL, -- JSON array of color stops

    -- SEO & Metadata
    page_title text NULL DEFAULT '3B SAIGON JUKEBOX',
    meta_description text NULL DEFAULT 'A boutique beer & music experience',
    open_graph_title text NULL DEFAULT '3B SAIGON JUKEBOX',

    -- Timestamps
    created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),

    CONSTRAINT branding_settings_pkey PRIMARY KEY (id),
    CONSTRAINT branding_settings_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
    CONSTRAINT branding_settings_profile_id_key UNIQUE (profile_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS branding_settings_profile_id_idx ON public.branding_settings (profile_id);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_branding_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER branding_settings_updated_at
    BEFORE UPDATE ON public.branding_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_branding_settings_updated_at();
```
