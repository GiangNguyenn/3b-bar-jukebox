# Bugfix Requirements Document

## Introduction

When the admin page (`/[username]/admin`) loads, the browser console is flooded with warnings and errors from four distinct issues: duplicate Supabase GoTrueClient instances, a 401 error on artist upserts, a missing favicon 404, and realtime websocket connection failures. These create noise that obscures real issues during development and degrade the admin experience.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the admin page loads THEN the system logs "Multiple GoTrueClient instances detected in the same browser context" warnings (appearing twice) because ~10 files create independent Supabase clients via `createClient` or `createBrowserClient` instead of reusing the singleton from `lib/supabase.ts`

1.2 WHEN the genre backfill process runs and calls `upsertArtistProfile` in `services/game/dgsCache.ts` THEN the system returns a 401 HTTP error on `POST .../rest/v1/artists?on_conflict=spotify_artist_id` because the anon key lacks permission to upsert to the artists table (RLS blocks it)

1.3 WHEN any page loads in the browser THEN the system returns a 404 for `GET /favicon.ico` because no `favicon.ico` file exists at the expected path (only `public/icon.ico` exists)

1.4 WHEN `usePlaylistData` sets up a realtime subscription THEN the system fails to establish a websocket connection to `wss://...supabase.co/realtime/v1/websocket`, likely exacerbated by multiple competing GoTrueClient instances creating conflicting auth states

### Expected Behavior (Correct)

2.1 WHEN the admin page loads THEN the system SHALL use a single shared Supabase browser client singleton across all browser-side code, eliminating the "Multiple GoTrueClient instances" warnings. Service-layer files (`utils/subscriptionQueries.ts`, `services/subscriptionCache.ts`, `services/subscriptionService.ts`) SHALL import from `lib/supabase.ts`. Browser hooks (`hooks/usePlaylistData.ts`, `hooks/useTrackGenre.ts`, `hooks/usePremiumStatus.ts`, `app/[username]/admin/components/branding/hooks/useBrandingSettings.ts`, `shared/utils/authCleanup.ts`) SHALL use a shared browser client singleton created with `createBrowserClient` from `@supabase/ssr`. `services/game/metadataBackfill.ts` SHALL import from `lib/supabase.ts`. `services/stripeService.ts` SHALL import from `lib/supabase-admin.ts` (since it uses the service role key for webhook operations).

2.2 WHEN the genre backfill process calls `upsertArtistProfile` THEN the system SHALL use the admin Supabase client (service role key from `lib/supabase-admin.ts`) for the artists table upsert, or SHALL gracefully skip the upsert without logging a 401 error when running in a browser context where the admin client is unavailable

2.3 WHEN any page loads in the browser THEN the system SHALL serve a valid favicon at `/favicon.ico` by providing a `favicon.ico` file (or Next.js App Router icon convention) so no 404 is returned

2.4 WHEN `usePlaylistData` sets up a realtime subscription THEN the system SHALL use the shared browser client singleton, which combined with fixing Issue 1 (eliminating competing GoTrueClient instances) SHALL resolve the websocket connection failures caused by conflicting auth states

### Unchanged Behavior (Regression Prevention)

3.1 WHEN any existing Supabase query runs (selects, inserts, updates, RPC calls) THEN the system SHALL CONTINUE TO return the same results as before, since only the client instantiation is changing, not the queries themselves

3.2 WHEN `services/stripeService.ts` processes Stripe webhooks THEN the system SHALL CONTINUE TO use the service role key with admin privileges for database operations

3.3 WHEN `lib/supabase-admin.ts` is used in server-side contexts THEN the system SHALL CONTINUE TO use the service role key with `autoRefreshToken: false` and `persistSession: false`

3.4 WHEN the realtime subscription in `usePlaylistData` encounters a connection error THEN the system SHALL CONTINUE TO fall back to polling at 30-second intervals

3.5 WHEN the genre backfill successfully retrieves artist data from Spotify THEN the system SHALL CONTINUE TO cache that data for future lookups (the caching behavior itself must not regress)

3.6 WHEN `usePremiumStatus` is called THEN the system SHALL CONTINUE TO function correctly (note: it imports `createBrowserClient` but does not appear to use it — the unused import should be cleaned up without changing behavior)

3.7 WHEN custom branding favicon settings are configured by a venue owner THEN the system SHALL CONTINUE TO dynamically replace the favicon via `usePublicBranding` as it does today
