# Implementation Plan

- [x] 1. Write bug condition exploration test

  - **Property 1: Bug Condition** — Fuzzy Name Mismatch Triggers Restart Loop
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Scope the property to concrete failing cases where track names differ only by parenthetical suffixes (feat., Remastered, etc.)
  - Create test file `services/playerLifecycle/__tests__/QueueSynchronizer.bugCondition.test.ts`
  - Use `node:test` and `node:assert` (no Jest/Vitest)
  - Build a minimal mock `PlaybackController` and mock `queueManager`, `playbackService`, `DJService`
  - Test case 1: SDK reports track name "Dirrty (feat. Redman)" with a relinked ID, queue has "Dirrty" — assert `playNextTrack()` is NOT called (will FAIL on unfixed code because simple toLowerCase comparison misses the suffix)
  - Test case 2: SDK reports "Bohemian Rhapsody - Remastered 2011", queue has "Bohemian Rhapsody" — assert `playNextTrack()` is NOT called (will FAIL on unfixed code)
  - Test case 3: Call `syncQueueWithPlayback()` twice with the same mismatched state — assert `playNextTrack()` is called at most once (will FAIL on unfixed code — called twice)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct — it proves the bug exists)
  - Document counterexamples found to understand root cause
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 2.1, 2.2_

- [x] 2. Write preservation property tests (BEFORE implementing fix)

  - **Property 2: Preservation** — Exact Match, Empty Queue, and Genuine Mismatch Behavior
  - **IMPORTANT**: Follow observation-first methodology
  - Create test file `services/playerLifecycle/__tests__/QueueSynchronizer.preservation.test.ts`
  - Use `node:test` and `node:assert` (no Jest/Vitest)
  - Build the same minimal mock infrastructure as task 1
  - Observe on UNFIXED code: when Spotify track ID exactly matches a queue item, `currentQueueTrack` is updated and `playNextTrack()` is NOT called
  - Observe on UNFIXED code: when queue is empty and playback is active, `setCurrentlyPlayingTrack(null)` is called and `playNextTrack()` is NOT called
  - Observe on UNFIXED code: when a completely different track is playing (no name match at all), `playNextTrack()` IS called with the expected track
  - Observe on UNFIXED code: when playback is paused, `setCurrentlyPlayingTrack(null)` is called and no queue enforcement occurs
  - Write property-based style tests covering these observed behaviors across varied inputs (random track IDs, names, queue sizes)
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 3. Fix song restart loop

  - [x] 3.1 Create `shared/utils/trackNameMatcher.ts` with fuzzy matching utilities

    - Implement `normalizeTrackName(name: string): string` — lowercase, strip parenthetical suffixes like "(feat. X)", "(Remastered 2011)", "(Deluxe Edition)", "(Live)", strip dash suffixes like "- Remastered", trim whitespace
    - Implement `fuzzyTrackNameMatch(queueName: string, spotifyName: string): boolean` — compare normalized versions, return true if base names match
    - Use `createModuleLogger` for any logging (never raw console.log)
    - Single quotes, no semicolons, no trailing commas (Prettier config)
    - _Bug_Condition: isBugCondition(input) where fuzzy match would succeed but simple toLowerCase fails due to parenthetical/suffix differences_
    - _Expected_Behavior: fuzzyTrackNameMatch returns true for same-song variants with different metadata suffixes_
    - _Preservation: fuzzyTrackNameMatch returns false for genuinely different track names_
    - _Requirements: 2.1_

  - [x] 3.2 Update `syncQueueWithPlayback()` in `QueueSynchronizer.ts` — replace simple toLowerCase comparison with fuzzyTrackNameMatch

    - Import `fuzzyTrackNameMatch` from `@/shared/utils/trackNameMatcher`
    - Replace `expectedTrack.tracks.name.toLowerCase() === currentSpotifyTrack.name.toLowerCase()` with `fuzzyTrackNameMatch(expectedTrack.tracks.name, currentSpotifyTrack.name)`
    - _Bug_Condition: isBugCondition(input) where track names differ by parenthetical suffixes_
    - _Expected_Behavior: fuzzy match catches relinked tracks with metadata differences, preventing false playNextTrack() calls_
    - _Preservation: exact ID matches and genuine mismatches behave identically to before_
    - _Requirements: 2.1_

  - [x] 3.3 Add force-play guard to `QueueSynchronizer.ts` — prevent repeated playNextTrack() calls for the same track

    - Add private field `lastForcePlayedTrackId: string | null = null`
    - In `syncQueueWithPlayback()`, before calling `playNextTrack()`, check if `currentSpotifyTrack.id === this.lastForcePlayedTrackId` — if so, skip the call
    - Set `lastForcePlayedTrackId = currentSpotifyTrack.id` when `playNextTrack()` is called
    - Clear `lastForcePlayedTrackId` when an exact match is found or a different track starts playing
    - _Bug_Condition: repeated syncQueueWithPlayback() calls for the same mismatched track trigger playNextTrack() each time_
    - _Expected_Behavior: playNextTrack() is called at most once per track; subsequent calls for the same track are skipped_
    - _Preservation: force-play guard resets when a genuinely different track starts, so legitimate queue enforcement still works_
    - _Requirements: 2.2, 2.3_

  - [x] 3.4 Add diagnostic logging in `syncQueueWithPlayback()` when match fails

    - Before calling `playNextTrack()`, log via `this.controller.log()`: Spotify track ID, expected queue track ID, both track names, fuzzy match result
    - Use `createModuleLogger` conventions — no raw console.log
    - _Requirements: 2.5_

  - [x] 3.5 Update `playNextTrackImpl()` — set lastForcePlayedTrackId on successful play

    - After successful `playTrackWithRetry()`, set `this.lastForcePlayedTrackId = currentTrack.tracks.spotify_track_id`
    - _Requirements: 2.2_

  - [x] 3.6 Add deduplication in `DJService.onTrackStarted()` — prevent repeated log clutter

    - Add private field `lastOnTrackStartedId: string | null = null` to DJService
    - At the start of `onTrackStarted()`, check if `_currentTrack.id === this.lastOnTrackStartedId` — if so, log a concise deduplication message and return early (skip prefetch)
    - Set `lastOnTrackStartedId = _currentTrack.id` on first call for a new track
    - Use existing `log()` helper in DJService for the dedup message
    - _Bug_Condition: restart loop causes onTrackStarted() to fire repeatedly for the same track_
    - _Expected_Behavior: only the first call per track triggers full roll/threshold logging and prefetch_
    - _Preservation: first call for each new track still triggers full onTrackStarted() logic including prefetch_
    - _Requirements: 2.4_

  - [x] 3.7 Update `markFinishedTrackAsPlayed()` — use fuzzyTrackNameMatch for fallback matching

    - Import `fuzzyTrackNameMatch` from `@/shared/utils/trackNameMatcher`
    - Replace `item.tracks.name.toLowerCase() === trackName.toLowerCase()` with `fuzzyTrackNameMatch(item.tracks.name, trackName)`
    - _Preservation: fallback matching becomes more robust without changing behavior for exact name matches_
    - _Requirements: 2.1_

  - [x] 3.8 Verify bug condition exploration test now passes

    - **Property 1: Expected Behavior** — Fuzzy Name Mismatch No Longer Triggers Restart Loop
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2_

  - [x] 3.9 Verify preservation tests still pass
    - **Property 2: Preservation** — Exact Match, Empty Queue, and Genuine Mismatch Behavior
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Checkpoint — Ensure all tests pass
  - Run full test suite to confirm no regressions
  - Ensure bug condition test (task 1) now passes
  - Ensure preservation tests (task 2) still pass
  - Ensure any existing project tests still pass
  - Ask the user if questions arise
