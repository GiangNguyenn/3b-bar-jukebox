# Implementation Plan

- [x] 1. Write bug condition exploration test

  - **Property 1: Bug Condition** — Stale Song Detection After Tab Backgrounding
  - **IMPORTANT**: Write this property-based test BEFORE implementing the fix
  - **GOAL**: Surface counterexamples that demonstrate the hook fails to detect song changes promptly after visibility restore
  - **Scoped PBT Approach**: Scope the property to the concrete failing scenario: tab backgrounded, song changes in DB, visibility restored, then observe detection timing
  - Create test file `hooks/__tests__/nowPlayingBurstBugCondition.test.ts` using `node:test` and `node:assert`
  - Mock `supabaseBrowser` to control `now_playing` table responses and Realtime channel behavior
  - Mock `document.visibilityState` and dispatch `visibilitychange` events
  - Test that after visibility restore, `useNowPlayingRealtime` with default 30s interval has NO accelerated polling burst — only a single `fetchFromTable` fires on visibility change
  - Test that if the single re-fetch returns stale data (race condition), the next poll is 30s away — no burst mechanism exists to retry sooner
  - Test that `useTriviaGame` calls `useNowPlayingRealtime` without passing a shorter `fallbackInterval` (relies on 30s default)
  - Run test on UNFIXED code — expect FAILURE (this confirms the bug exists: no burst polling, 30s gap)
  - **EXPECTED OUTCOME**: Test FAILS — confirms there is no accelerated polling burst after visibility restore and the game page uses the slow 30s default
  - Document counterexamples: e.g., 'After visibility restore with stale re-fetch, hook does not poll again for 30s' and 'useTriviaGame does not pass fallbackInterval to useNowPlayingRealtime'
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)

  - **Property 2: Preservation** — Foreground Realtime and Game Behavior Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Create test file `hooks/__tests__/nowPlayingBurstPreservation.test.ts` using `node:test` and `node:assert`
  - Observe on UNFIXED code: when tab stays in foreground, Realtime subscription delivers `now_playing` updates and no burst polling is triggered
  - Observe on UNFIXED code: when `now_playing` row updates with play/pause change (same track ID), `useTriviaGame` does NOT fetch a new trivia question
  - Observe on UNFIXED code: when a song change is detected (new track ID), `useTriviaGame` fetches a new trivia question, resets answer state, and displays the new question
  - Observe on UNFIXED code: `rowToPlaybackState` correctly transforms a `NowPlayingRow` into `SpotifyPlaybackState` shape with all fields populated
  - Write property-based tests:
    - For all foreground states (no visibility change): Realtime updates are reflected in hook state, no burst timers created, normal `fallbackInterval` polling maintained
    - For all play/pause updates (same track ID): `useTriviaGame` does not re-fetch trivia question — `lastFetchedTrackIdRef` prevents duplicate fetches
    - For all song change events (different track ID): `useTriviaGame` resets `selectedAnswer`, `isCorrect`, and `question` state, then fetches new question
    - For all valid `NowPlayingRow` inputs: `rowToPlaybackState` produces correct `SpotifyPlaybackState` with matching `item.id`, `item.name`, `is_playing`, `progress_ms`
  - Verify all tests PASS on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS — confirms baseline behavior to preserve
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. Fix for stale song detection after tab backgrounding

  - [x] 3.1 Add accelerated polling burst on visibility restore to useNowPlayingRealtime

    - In `hooks/useNowPlayingRealtime.ts`, add a `burstIntervalRef` (ref for the burst timer) and a `burstTimeoutRef` (ref for the burst duration timeout)
    - In `handleVisibilityChange`, when `document.visibilityState === 'visible'`:
      - Clear any existing burst timer to prevent overlapping bursts from rapid visibility changes
      - Start burst polling: `setInterval(fetchFromTable, 2000)` stored in `burstIntervalRef`
      - Set a timeout at 10s to clear the burst interval and restart the normal `fallbackInterval` polling
    - Clear and restart the normal `intervalRef` after burst ends to avoid overlapping timers
    - Log burst activation and deactivation using `console.warn` (consistent with existing subscription status logging in this hook)
    - Clean up both `burstIntervalRef` and `burstTimeoutRef` in the effect cleanup function
    - _Bug_Condition: isBugCondition(input) where tabWasBackgrounded AND songChangedWhileBackgrounded AND single re-fetch missed the change_
    - _Expected_Behavior: Burst polls every 2s for 10s after visibility restore, then reverts to normal fallbackInterval_
    - _Preservation: When tab stays in foreground, no burst timers are created; normal Realtime + fallback polling unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 1.1, 1.2, 1.3_

  - [x] 3.2 Pass shorter fallbackInterval from useTriviaGame

    - In `hooks/trivia/useTriviaGame.ts`, change the `useNowPlayingRealtime` call from `useNowPlayingRealtime({ profileId })` to `useNowPlayingRealtime({ profileId, fallbackInterval: 5000 })`
    - This ensures the game page polls every 5s even outside of burst periods, reducing the worst-case detection gap
    - _Bug_Condition: Game page relies on 30s default polling interval — too slow for trivia gameplay_
    - _Expected_Behavior: Game page polls every 5s, reducing max detection delay from 30s to 5s_
    - _Preservation: Display page and other consumers of useNowPlayingRealtime continue using their own fallbackInterval (default 30s)_
    - _Requirements: 2.1, 2.3_

  - [x] 3.3 Verify bug condition exploration test now passes

    - **Property 1: Expected Behavior** — Song Change Detected After Visibility Restore
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior: burst polling activates after visibility restore (2s interval for 10s), and useTriviaGame passes fallbackInterval: 5000
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed — accelerated polling burst exists and game page uses 5s interval)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.4 Verify preservation tests still pass
    - **Property 2: Preservation** — Foreground Realtime and Game Behavior Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions — foreground Realtime delivery, play/pause handling, trivia question fetching, rowToPlaybackState all unchanged)
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Checkpoint — Ensure all tests pass
  - Run full test suite: `yarn test`
  - Ensure bug condition test (task 1) passes after fix
  - Ensure preservation tests (task 2) still pass after fix
  - Ensure all existing project tests still pass
  - Ask the user if questions arise
