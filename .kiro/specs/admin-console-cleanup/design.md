# Admin Console Cleanup Bugfix Design

## Overview

The admin page loads with four categories of console noise: duplicate GoTrueClient warnings, a 401 on artist upserts, a missing favicon 404, and realtime websocket failures. The root cause is fragmented Supabase client instantiation — ~15 call sites create independent clients instead of sharing singletons. The fix consolidates browser-side clients into a new `lib/supabase-browser.ts` singleton, switches `dgsCache.ts` artist upserts to the admin client, adds a `public/favicon.ico`, and lets the websocket issue resolve as a side effect of client consolidation.

## Glossary

- **Bug_Condition (C)**: Any page load or server-side operation that triggers one of the four console errors (duplicate GoTrueClient, 401 upsert, favicon 404, websocket failure)
- **Property (P)**: Zero spurious warnings/errors in the browser console on admin page load; artist upserts succeed; favicon resolves; realtime connects cleanly
- **Preservation**: All existing Supabase queries, auth flows, realtime subscriptions, polling fallbacks, and dynamic branding favicon replacement must continue working identically
- **`lib/supabase.ts`**: Existing server-side singleton using `createClient` with the anon key
- **`lib/supabase-admin.ts`**: Existing server-side singleton using `createClient` with the service role key
- **`lib/supabase-browser.ts`**: New browser-side singleton to be created using `createBrowserClient` from `@supabase/ssr`
- **`dgsCache.ts`**: `services/game/dgsCache.ts` — database cache layer for the DGS game engine, contains `upsertArtistProfile` and `batchUpsertArtistProfiles`

## Bug Details

### Bug Condition

The bug manifests across four independent symptoms that share a common root cause of fragmented Supabase client creation. Each browser page load creates ~15 independent Supabase client instances (via `createBrowserClient` in hooks/pages and `createClient` in services), triggering GoTrueClient warnings. The `dgsCache.ts` module uses the anon-key client for artist upserts that require service-role privileges. No `favicon.ico` exists at the expected path. Realtime websocket connections fail due to competing auth states from multiple GoTrueClient instances.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { context: 'browser-load' | 'server-upsert' | 'asset-request' | 'realtime-connect', details: any }
  OUTPUT: boolean

  IF input.context == 'browser-load'
    RETURN countSupabaseBrowserClients() > 1
  ELSE IF input.context == 'server-upsert'
    RETURN input.details.table == 'artists'
           AND input.details.operation == 'upsert'
           AND clientUsed(input).key == 'anon'
  ELSE IF input.context == 'asset-request'
    RETURN input.details.path == '/favicon.ico'
           AND NOT fileExists('public/favicon.ico')
  ELSE IF input.context == 'realtime-connect'
    RETURN countGoTrueClientInstances() > 1
           AND input.details.channel == 'queue-changes'
  ELSE
    RETURN false
END FUNCTION
```

### Examples

- Admin page load → console shows "Multiple GoTrueClient instances detected in the same browser context" (appears twice) because `usePlaylistData`, `useBrandingSettings`, `useTrackGenre`, `ProtectedRoute`, `analytics-tab`, `popularity-histogram`, `release-year-histogram`, `authCleanup`, `app/page.tsx`, `app/premium-required/page.tsx`, `app/auth/signin/page.tsx`, and `useGetProfile` each call `createBrowserClient()`
- Genre backfill runs `upsertArtistProfile` → POST to `/rest/v1/artists?on_conflict=spotify_artist_id` returns HTTP 401 because the anon key lacks RLS permission for upsert on the `artists` table
- Any page load → GET `/favicon.ico` returns 404 (only `public/icon.ico` exists)
- `usePlaylistData` subscribes to realtime → websocket to `wss://...supabase.co/realtime/v1/websocket` fails to connect, likely due to conflicting auth tokens from multiple GoTrueClient instances


## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- All existing Supabase queries (selects, inserts, updates, RPC calls) must return identical results — only client instantiation changes, not queries
- `services/stripeService.ts` must continue using the service role key with admin privileges for Stripe webhook database operations
- `lib/supabase-admin.ts` must remain unchanged with `autoRefreshToken: false` and `persistSession: false`
- Realtime subscription fallback to 30-second polling in `usePlaylistData` must continue working on connection error
- Genre backfill caching behavior in `dgsCache.ts` must continue to cache artist data for future lookups
- Dynamic favicon replacement via `usePublicBranding` for custom branding must continue working (the static `favicon.ico` is only a default fallback)

**Scope:**
All inputs that do NOT involve the four bug conditions should be completely unaffected by this fix. This includes:
- Normal Supabase query execution (reads, writes via API routes)
- Spotify playback SDK operations
- Stripe webhook processing
- NextAuth authentication flows
- All UI rendering and state management

## Hypothesized Root Cause

Based on the bug description and code analysis, the root causes are:

1. **No Browser Client Singleton**: There is no `lib/supabase-browser.ts` equivalent of `lib/supabase.ts`. Each React hook and page component calls `createBrowserClient<Database>(url, key)` independently, creating a new `GoTrueClient` per call site. The `@supabase/ssr` `createBrowserClient` does attempt deduplication via cookies, but multiple instances still trigger the warning and create competing auth state managers.

2. **Server-Side Services Creating Own Clients**: `services/subscriptionService.ts`, `services/subscriptionCache.ts`, `utils/subscriptionQueries.ts`, and `services/game/metadataBackfill.ts` each call `createClient()` in their constructors instead of importing the singleton from `lib/supabase.ts`. `services/stripeService.ts` creates its own client with service role key instead of importing from `lib/supabase-admin.ts`.

3. **Wrong Client Privilege Level for Artist Upsert**: `services/game/dgsCache.ts` imports `supabase` from `lib/supabase.ts` (anon key). The `artists` table has RLS policies that block anon-key upserts. Since `dgsCache.ts` runs exclusively in API routes (server-side), it should use `supabaseAdmin` from `lib/supabase-admin.ts` for write operations.

4. **Missing Favicon File**: The project has `public/icon.ico` but no `public/favicon.ico`. Browsers request `/favicon.ico` by default. Next.js App Router also supports a `app/favicon.ico` convention, but neither exists.

5. **Realtime Websocket Failures (Secondary)**: Multiple `GoTrueClient` instances create conflicting auth token refresh cycles. When `usePlaylistData` tries to establish a realtime websocket, the connection may fail because another instance's token refresh invalidated the token being used. This should resolve once all browser-side code shares a single client.

## Correctness Properties

Property 1: Bug Condition - Browser Client Singleton Eliminates GoTrueClient Warnings

_For any_ browser page load where React hooks and components need a Supabase client, the system SHALL provide a single shared `createBrowserClient` instance from `lib/supabase-browser.ts`, resulting in exactly one GoTrueClient instance and zero "Multiple GoTrueClient instances" warnings.

**Validates: Requirements 2.1, 2.4**

Property 2: Bug Condition - Artist Upsert Uses Admin Client

_For any_ call to `upsertArtistProfile` or `batchUpsertArtistProfiles` in `dgsCache.ts`, the function SHALL use the admin Supabase client (service role key) from `lib/supabase-admin.ts`, resulting in successful upserts with no 401 errors.

**Validates: Requirements 2.2**

Property 3: Bug Condition - Favicon Resolves Successfully

_For any_ browser request to `/favicon.ico`, the server SHALL return a valid ICO file with HTTP 200, eliminating the 404 error.

**Validates: Requirements 2.3**

Property 4: Preservation - Existing Query Behavior Unchanged

_For any_ Supabase query (select, insert, update, delete, RPC) executed through the consolidated clients, the query SHALL produce the same results as the original fragmented clients, preserving all existing data access patterns and RLS behavior.

**Validates: Requirements 3.1, 3.2, 3.3, 3.5**

Property 5: Preservation - Realtime Fallback Preserved

_For any_ realtime connection error in `usePlaylistData`, the system SHALL continue to fall back to 30-second polling intervals, preserving the existing recovery behavior.

**Validates: Requirements 3.4**

Property 6: Preservation - Dynamic Favicon Override Preserved

_For any_ venue with custom branding favicon settings, the `usePublicBranding` hook SHALL continue to dynamically replace the favicon at runtime, with the static `favicon.ico` serving only as the initial default.

**Validates: Requirements 3.7**


## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `lib/supabase-browser.ts` (NEW)

**Purpose**: Create a browser-side Supabase client singleton

**Specific Changes**:
1. **Create singleton module**: Export a single `supabaseBrowser` instance created via `createBrowserClient<Database>()` from `@supabase/ssr`. This mirrors the pattern of `lib/supabase.ts` but for browser contexts.

---

**File**: `hooks/usePlaylistData.ts`

**Function**: `usePlaylistData`

**Specific Changes**:
1. **Replace inline client**: Remove `createBrowserClient` import and inline instantiation. Import `supabaseBrowser` from `@/lib/supabase-browser` instead.

---

**File**: `hooks/useTrackGenre.ts`

**Function**: `useTrackGenre`

**Specific Changes**:
1. **Replace inline client**: Remove `createBrowserClient` import and `useMemo` wrapper. Import `supabaseBrowser` from `@/lib/supabase-browser`.

---

**File**: `hooks/useGetProfile.tsx`

**Function**: `useGetProfile`

**Specific Changes**:
1. **Replace inline client**: Remove `createBrowserClient` import and `useMemo` wrapper. Import `supabaseBrowser` from `@/lib/supabase-browser`.

---

**File**: `hooks/usePremiumStatus.ts`

**Function**: `usePremiumStatus`

**Specific Changes**:
1. **Remove unused import**: Remove the `createBrowserClient` import and `@supabase/ssr` dependency since the hook doesn't actually use a Supabase client (it's a no-op stub returning hardcoded premium status).

---

**File**: `shared/utils/authCleanup.ts`

**Function**: `clearAuthenticationState`

**Specific Changes**:
1. **Replace inline client**: Remove `createBrowserClient` import and inline instantiation inside the function body. Import `supabaseBrowser` from `@/lib/supabase-browser`.

---

**File**: `app/[username]/admin/components/branding/hooks/useBrandingSettings.ts`

**Function**: `useBrandingSettings`

**Specific Changes**:
1. **Replace inline client**: Remove `createBrowserClient` import and inline instantiation. Import `supabaseBrowser` from `@/lib/supabase-browser`.

---

**File**: `app/[username]/admin/components/analytics/analytics-tab.tsx`

**Specific Changes**:
1. **Replace inline clients**: This file has three components each creating their own client. Remove all `createBrowserClient` calls and import `supabaseBrowser` from `@/lib/supabase-browser`.

---

**File**: `app/[username]/admin/components/analytics/popularity-histogram.tsx`

**Specific Changes**:
1. **Replace inline client**: Remove `createBrowserClient` import and inline instantiation. Import `supabaseBrowser` from `@/lib/supabase-browser`.

---

**File**: `app/[username]/admin/components/analytics/release-year-histogram.tsx`

**Specific Changes**:
1. **Replace inline client**: Remove `createBrowserClient` import and inline instantiation. Import `supabaseBrowser` from `@/lib/supabase-browser`.

---

**File**: `app/[username]/admin/components/ProtectedRoute.tsx`

**Specific Changes**:
1. **Replace inline client**: Remove `createBrowserClient` import and `useMemo` wrapper. Import `supabaseBrowser` from `@/lib/supabase-browser`.

---

**File**: `app/page.tsx`

**Specific Changes**:
1. **Replace inline client**: Remove `createBrowserClient` import and inline instantiation. Import `supabaseBrowser` from `@/lib/supabase-browser`.

---

**File**: `app/premium-required/page.tsx`

**Specific Changes**:
1. **Replace inline client**: Remove `createBrowserClient` import and inline instantiation. Import `supabaseBrowser` from `@/lib/supabase-browser`.

---

**File**: `app/auth/signin/page.tsx`

**Specific Changes**:
1. **Replace inline client**: Remove `createBrowserClient` import and inline instantiation. Import `supabaseBrowser` from `@/lib/supabase-browser`.

---

**File**: `services/game/dgsCache.ts`

**Functions**: `upsertArtistProfile`, `batchUpsertArtistProfiles`

**Specific Changes**:
1. **Import admin client**: Add import of `supabaseAdmin` from `@/lib/supabase-admin`.
2. **Switch upsert calls**: Change `upsertArtistProfile` and `batchUpsertArtistProfiles` to use `supabaseAdmin` instead of `supabase` for the `.from('artists').upsert()` calls. Keep all read operations on the anon client since RLS allows reads.

---

**File**: `services/game/metadataBackfill.ts`

**Specific Changes**:
1. **Replace inline client**: Remove `createClient` import and module-level instantiation. Import `supabase` from `@/lib/supabase`.

---

**File**: `services/subscriptionService.ts`

**Specific Changes**:
1. **Replace constructor client**: Remove `createClient` import and constructor instantiation. Import `supabase` from `@/lib/supabase` and assign to `this.supabase`.

---

**File**: `services/subscriptionCache.ts`

**Specific Changes**:
1. **Replace constructor client**: Remove `createClient` import and constructor instantiation. Import `supabase` from `@/lib/supabase` and assign to `this.supabase`.

---

**File**: `utils/subscriptionQueries.ts`

**Specific Changes**:
1. **Replace constructor client**: Remove `createClient` import and constructor instantiation. Import `supabase` from `@/lib/supabase` and assign to `this.supabase`.

---

**File**: `services/stripeService.ts`

**Specific Changes**:
1. **Replace constructor client**: Remove `createClient` and `createServerClient` imports and constructor instantiation. Import `supabaseAdmin` from `@/lib/supabase-admin` and assign to `this.supabase`. This preserves the service role key usage while eliminating the redundant client.

---

**File**: `public/favicon.ico` (NEW)

**Specific Changes**:
1. **Copy existing icon**: Copy `public/icon.ico` to `public/favicon.ico` so browsers find the favicon at the default path.


## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bugs on unfixed code, then verify the fix works correctly and preserves existing behavior. The project uses Node.js built-in test runner (`node:test`) via `tsx --test`.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bugs BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that statically analyze imports and instantiation patterns across the codebase, and unit tests that verify the client used by `dgsCache.ts` for upserts. Run these tests on the UNFIXED code to observe failures.

**Test Cases**:
1. **Duplicate Client Detection Test**: Count the number of files that call `createBrowserClient()` directly — expect >1, confirming the duplication (will fail assertion that count == 1 on unfixed code)
2. **Artist Upsert Client Test**: Verify that `dgsCache.ts` imports from `lib/supabase.ts` (anon key) — confirm this is the wrong client for upserts (will fail assertion that admin client is used on unfixed code)
3. **Favicon Existence Test**: Check that `public/favicon.ico` exists — will fail on unfixed code since only `public/icon.ico` exists
4. **Server-Side Service Client Test**: Verify that `subscriptionService.ts`, `subscriptionCache.ts`, `subscriptionQueries.ts` create their own clients instead of importing singletons (will fail singleton assertion on unfixed code)

**Expected Counterexamples**:
- 15+ files independently instantiate Supabase clients
- `dgsCache.ts` uses anon key for artist upserts, triggering RLS 401
- No `public/favicon.ico` file exists

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed code produces the expected behavior.

**Pseudocode:**
```
FOR ALL browserModule WHERE usesBrowserSupabaseClient(browserModule) DO
  client := getSupabaseClientUsed(browserModule)
  ASSERT client === supabaseBrowserSingleton
END FOR

FOR ALL upsertCall WHERE targetsArtistsTable(upsertCall) DO
  client := getClientUsed(upsertCall)
  ASSERT client.key === 'service_role'
END FOR

ASSERT fileExists('public/favicon.ico')
ASSERT fileContent('public/favicon.ico') === fileContent('public/icon.ico')
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed code produces the same result as the original code.

**Pseudocode:**
```
FOR ALL query WHERE isStandardSupabaseQuery(query) DO
  ASSERT executeWithNewClient(query) === executeWithOldClient(query)
END FOR

FOR ALL realtimeError WHERE isConnectionFailure(realtimeError) DO
  ASSERT fallbackBehavior(realtimeError) === pollingAt30Seconds
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for normal query execution and realtime fallback, then write tests capturing that behavior.

**Test Cases**:
1. **Query Result Preservation**: Verify that queries through the singleton client return the same results as queries through independently created clients (same URL, same key = same results)
2. **Realtime Fallback Preservation**: Verify that `usePlaylistData` still falls back to 30-second polling on connection error after switching to the singleton client
3. **Stripe Webhook Preservation**: Verify that `stripeService.ts` still uses service role key privileges after switching to `supabaseAdmin` import
4. **Auth Cleanup Preservation**: Verify that `clearAuthenticationState` still signs out and clears storage after switching to the singleton client

### Unit Tests

- Test that `lib/supabase-browser.ts` exports a valid Supabase client instance
- Test that `lib/supabase-browser.ts` returns the same instance on repeated imports (singleton behavior)
- Test that `upsertArtistProfile` calls `.from('artists').upsert()` on the admin client
- Test that `batchUpsertArtistProfiles` calls `.from('artists').upsert()` on the admin client
- Test that `usePremiumStatus` has no `createBrowserClient` import (unused import removed)
- Test that `public/favicon.ico` exists and is a valid ICO file

### Property-Based Tests

- Generate random sets of browser-side module imports and verify they all resolve to the same singleton client reference
- Generate random artist data payloads and verify `upsertArtistProfile` always uses the admin client regardless of input shape
- Generate random query configurations and verify the singleton client produces identical results to an independently created client with the same credentials

### Integration Tests

- Load the admin page and verify zero "Multiple GoTrueClient instances" warnings in console
- Trigger genre backfill and verify artist upsert succeeds with HTTP 200 (no 401)
- Request `/favicon.ico` and verify HTTP 200 response with valid ICO content
- Establish realtime subscription via `usePlaylistData` and verify websocket connects successfully
