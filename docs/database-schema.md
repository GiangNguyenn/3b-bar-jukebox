create table public.jukebox_queue (
id uuid not null default gen_random_uuid (),
profile_id uuid not null,
track_id uuid not null,
votes integer not null default 0,
queued_at timestamp with time zone not null default timezone ('utc'::text, now()),
constraint jukebox_queue_pkey primary key (id),
constraint jukebox_queue_profile_id_fkey foreign KEY (profile_id) references profiles (id) on delete CASCADE,
constraint jukebox_queue_track_id_fkey foreign KEY (track_id) references tracks (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists jukebox_queue_profile_id_idx on public.jukebox_queue using btree (profile_id) TABLESPACE pg_default;

create index IF not exists jukebox_queue_track_id_idx on public.jukebox_queue using btree (track_id) TABLESPACE pg_default;

create index IF not exists jukebox_queue_profile_id_votes_queued_at_idx on public.jukebox_queue using btree (profile_id, votes desc, queued_at) TABLESPACE pg_default;

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

create table public.suggested_tracks (
profile_id uuid not null,
track_id uuid not null,
count integer not null default 1,
first_suggested_at timestamp with time zone not null,
last_suggested_at timestamp with time zone not null,
constraint suggested_tracks_pkey primary key (profile_id, track_id),
constraint suggested_tracks_profile_id_fkey foreign KEY (profile_id) references profiles (id) on delete CASCADE,
constraint suggested_tracks_track_id_fkey foreign KEY (track_id) references tracks (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists suggested_tracks_profile_id_idx on public.suggested_tracks using btree (profile_id) TABLESPACE pg_default;

create index IF not exists suggested_tracks_track_id_idx on public.suggested_tracks using btree (track_id) TABLESPACE pg_default;

create table public.tracks (
id uuid not null default gen_random_uuid (),
spotify_track_id text not null,
name text not null,
artist text not null,
album text not null,
genre text null,
release_year integer null,
duration_ms integer not null,
popularity integer not null,
spotify_url text null,
created_at timestamp with time zone not null default timezone ('utc'::text, now()),
constraint tracks_pkey primary key (id)
) TABLESPACE pg_default;

create unique INDEX IF not exists tracks_spotify_track_id_idx on public.tracks using btree (spotify_track_id) TABLESPACE pg_default;
