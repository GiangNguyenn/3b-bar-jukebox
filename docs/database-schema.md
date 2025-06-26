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
