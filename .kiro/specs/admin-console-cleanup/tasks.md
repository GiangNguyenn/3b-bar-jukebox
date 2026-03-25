# Implementation Plan

- [x] 1. Write bug condition exploration test

  - **Property 1: Bug Condition** - Fragmented Supabase Client Instantiation
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bugs exist
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the four bug conditions exist
  - **Scoped PBT Approach**: For each bug condition, scope the property to concrete failing cases for reproducibility
  - Create test file `lib/__tests__/supabase-client-consolidation.test.ts` using `node:test` and `node:assert`
  - Test 1 - Duplicate browser clients: Statically read browser-side files (`hooks/usePlaylistData.ts`, `hooks/useTrackGenre.ts`, `hooks/useGetProfile.tsx`, `shared/utils/authCleanup.ts`, `app/[username]/admin/components/branding/hooks/useBrandingSettings.ts`, `app/[username]/admin/components/analytics/analytics-tab.tsx`, `app/[username]/admin/components/analytics/popularity-histogram.tsx`, `app/[username]/admin/components/analytics/release-year-histogram.tsx`, `app/[username]/admin/components/ProtectedRoute.tsx`, `app/page.tsx`, `app/premium-required/page.tsx`, `app/auth/signin/page.tsx`) and assert NONE contain `createBrowserClient(` calls (from `isBugCondition: countSupabaseBrowserClients() > 1`)
  - Test 2 - Artist upsert client: Read `services/game/dgsCache.ts` and assert upsert functions use `supabaseAdmin` from `lib/supabase-admin` (from `isBugCondition: clientUsed(input).key == 'anon'`)
  - Test 3 - Favicon existence: Assert `public/favicon.ico` exists (from `isBugCondition: NOT fileExists('public/favicon.ico')`)
  - Test 4 - Server-side singleton usage: Read `services/subscriptionService.ts`, `services/subscriptionCache.ts`, `utils/subscriptionQueries.ts`, `services/game/metadataBackfill.ts` and assert they import from `lib/supabase` singleton, not `createClient` directly. Read `services/stripeService.ts` and assert it imports from `lib/supabase-admin`.
  - Run test on UNFIXED code via `npx tsx --test lib/__tests__/supabase-client-consolidation.test.ts`
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct - proves the bugs exist)
  - Document counterexamples: e.g. "12 files call createBrowserClient() directly", "dgsCache.ts imports from lib/supabase (anon key)", "public/favicon.ico does not exist", "subscriptionService.ts calls createClient() in constructor"
  - Mark task complete when test is written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Write preservation property tests (BEFORE implementing fix)

  - **Property 2: Preservation** - Existing Client Configuration and Behavior Preserved
  - **IMPORTANT**: Follow observation-first methodology
  - Create test file `lib/__tests__/supabase-client-preservation.test.ts` using `node:test` and `node:assert`
  - Observe on UNFIXED code: `lib/supabase.ts` exports a client created with anon key and NEXT_PUBLIC_SUPABASE_URL
  - Observe on UNFIXED code: `lib/supabase-admin.ts` exports a client created with service role key, `autoRefreshToken: false`, `persistSession: false`
  - Observe on UNFIXED code: `services/stripeService.ts` uses service role key (via SUPABASE_SERVICE_ROLE_KEY env var) for webhook operations
  - Observe on UNFIXED code: `hooks/usePremiumStatus.ts` imports `createBrowserClient` but never uses it (unused import)
  - Write property tests:
    - `lib/supabase-admin.ts` still exports a client with `autoRefreshToken: false` and `persistSession: false` (read file, assert config present)
    - `services/stripeService.ts` uses admin-level client (service role key) for database operations (read file, assert imports `supabaseAdmin` from `lib/supabase-admin` or uses service role key)
    - `hooks/usePremiumStatus.ts` has no unused Supabase imports (read file, assert no `createBrowserClient` import)
    - `services/game/dgsCache.ts` read operations still use anon client (assert `supabase` import from `lib/supabase` is retained for reads)
    - For all server-side service files, assert they use singleton imports (not inline `createClient` calls) — this preserves query behavior since same URL + same key = same results (validates Preservation Requirement: query results unchanged)
  - Run tests on UNFIXED code via `npx tsx --test lib/__tests__/supabase-client-preservation.test.ts`
  - **EXPECTED OUTCOME**: Tests PASS (confirms baseline behavior to preserve)
  - Note: some preservation tests may need adjustment since unfixed code doesn't yet match the preserved state — focus on properties that are true BOTH before and after the fix (e.g., admin client config, service role key usage pattern)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 3. Consolidate Supabase client instantiation and fix console errors

  - [x] 3.1 Create `lib/supabase-browser.ts` browser-side singleton

    - Create new file exporting `supabaseBrowser` via `createBrowserClient<Database>()` from `@supabase/ssr`
    - Use `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` env vars
    - Mirror the singleton pattern of `lib/supabase.ts` but for browser contexts
    - _Bug_Condition: isBugCondition({ context: 'browser-load' }) where countSupabaseBrowserClients() > 1_
    - _Expected_Behavior: Single shared createBrowserClient instance from lib/supabase-browser.ts_
    - _Preservation: All existing queries return identical results — only instantiation changes_
    - _Requirements: 2.1, 2.4_

  - [x] 3.2 Update browser-side files to use `supabaseBrowser` singleton

    - Replace `createBrowserClient` calls with `supabaseBrowser` import from `@/lib/supabase-browser` in:
      - `hooks/usePlaylistData.ts` — remove `createBrowserClient` import and inline instantiation
      - `hooks/useTrackGenre.ts` — remove `createBrowserClient` import and `useMemo` wrapper
      - `hooks/useGetProfile.tsx` — remove `createBrowserClient` import and `useMemo` wrapper
      - `shared/utils/authCleanup.ts` — remove `createBrowserClient` import and inline instantiation in function body
      - `app/[username]/admin/components/branding/hooks/useBrandingSettings.ts` — remove `createBrowserClient` import and inline instantiation
      - `app/[username]/admin/components/analytics/analytics-tab.tsx` — remove all `createBrowserClient` calls (three components)
      - `app/[username]/admin/components/analytics/popularity-histogram.tsx` — remove `createBrowserClient` import and inline instantiation
      - `app/[username]/admin/components/analytics/release-year-histogram.tsx` — remove `createBrowserClient` import and inline instantiation
      - `app/[username]/admin/components/ProtectedRoute.tsx` — remove `createBrowserClient` import and `useMemo` wrapper
      - `app/page.tsx` — remove `createBrowserClient` import and inline instantiation
      - `app/premium-required/page.tsx` — remove `createBrowserClient` import and inline instantiation
      - `app/auth/signin/page.tsx` — remove `createBrowserClient` import and inline instantiation
    - Remove unused `createBrowserClient` import from `hooks/usePremiumStatus.ts` (no replacement needed — hook doesn't use a Supabase client)
    - _Bug_Condition: isBugCondition({ context: 'browser-load' }) where countSupabaseBrowserClients() > 1_
    - _Expected_Behavior: All browser-side files import supabaseBrowser singleton, zero duplicate GoTrueClient warnings_
    - _Preservation: Query behavior unchanged — same URL, same key, same results_
    - _Requirements: 2.1, 2.4, 3.1, 3.6_

  - [x] 3.3 Update server-side service files to use existing singletons

    - `services/subscriptionService.ts` — remove `createClient` import and constructor instantiation, import `supabase` from `@/lib/supabase`, assign to `this.supabase`
    - `services/subscriptionCache.ts` — remove `createClient` import and constructor instantiation, import `supabase` from `@/lib/supabase`, assign to `this.supabase`
    - `utils/subscriptionQueries.ts` — remove `createClient` import and constructor instantiation, import `supabase` from `@/lib/supabase`, assign to `this.supabase`
    - `services/game/metadataBackfill.ts` — remove `createClient` import and module-level instantiation, import `supabase` from `@/lib/supabase`
    - _Bug_Condition: Server-side services creating redundant clients instead of using singletons_
    - _Expected_Behavior: All server-side services use lib/supabase.ts singleton_
    - _Preservation: Same anon key, same URL — query results identical_
    - _Requirements: 2.1, 3.1_

  - [x] 3.4 Switch `services/stripeService.ts` to `lib/supabase-admin.ts`

    - Remove `createClient` and `createServerClient` imports and constructor client instantiation
    - Import `supabaseAdmin` from `@/lib/supabase-admin` and assign to `this.supabase`
    - This preserves service role key usage while eliminating the redundant client
    - _Bug_Condition: stripeService creates its own admin client instead of using singleton_
    - _Expected_Behavior: stripeService uses supabaseAdmin from lib/supabase-admin.ts_
    - _Preservation: Service role key with autoRefreshToken: false, persistSession: false preserved via lib/supabase-admin.ts_
    - _Requirements: 2.1, 3.2, 3.3_

  - [x] 3.5 Switch `dgsCache.ts` upsert functions to admin client

    - Add import of `supabaseAdmin` from `@/lib/supabase-admin`
    - Change `upsertArtistProfile` to use `supabaseAdmin` for `.from('artists').upsert()` call
    - Change `batchUpsertArtistProfiles` to use `supabaseAdmin` for `.from('artists').upsert()` call
    - Keep all read operations (`.from('artists').select()`, etc.) on the existing `supabase` anon client
    - _Bug_Condition: isBugCondition({ context: 'server-upsert' }) where clientUsed.key == 'anon' for artists upsert_
    - _Expected_Behavior: upsert uses service_role key, no 401 errors_
    - _Preservation: Read operations unchanged, caching behavior preserved_
    - _Requirements: 2.2, 3.5_

  - [x] 3.6 Add `public/favicon.ico`

    - Copy `public/icon.ico` to `public/favicon.ico`
    - _Bug_Condition: isBugCondition({ context: 'asset-request' }) where NOT fileExists('public/favicon.ico')_
    - _Expected_Behavior: GET /favicon.ico returns HTTP 200 with valid ICO file_
    - _Preservation: Dynamic favicon replacement via usePublicBranding continues working — static favicon.ico is only the default fallback_
    - _Requirements: 2.3, 3.7_

  - [x] 3.7 Verify bug condition exploration test now passes

    - **Property 1: Expected Behavior** - Fragmented Supabase Client Instantiation Fixed
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior (singleton usage, admin client for upserts, favicon exists)
    - Run `npx tsx --test lib/__tests__/supabase-client-consolidation.test.ts`
    - **EXPECTED OUTCOME**: Test PASSES (confirms all four bug conditions are resolved)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.8 Verify preservation tests still pass
    - **Property 2: Preservation** - Existing Client Configuration and Behavior Preserved
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run `npx tsx --test lib/__tests__/supabase-client-preservation.test.ts`
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all preservation tests still pass after fix (no regressions)

- [x] 4. Checkpoint - Ensure all tests pass
  - Run full test suite: `npx tsx --test lib/__tests__/supabase-client-consolidation.test.ts lib/__tests__/supabase-client-preservation.test.ts`
  - Verify all bug condition tests pass (Property 1)
  - Verify all preservation tests pass (Property 2)
  - Run `yarn lint:check` to ensure no lint errors from import changes
  - Ensure all tests pass, ask the user if questions arise.
