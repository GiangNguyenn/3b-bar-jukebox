# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** — Track Finish Does Not Record Recently Played
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Scope the property to concrete failing cases where a track finishes naturally via `handleTrackFinished()` and `addToRecentlyPlayed` is never called
  - Create test file `services/playerLifecycle/__tests__/QueueSynchronizer.recentlyPlayed.bugCondition.test.ts`
  - Use `node:test` and `node:assert` (no Jest/Vitest)
  - Mock `addToRecentlyPlayed` from `@/services/aiSuggestion`, `queueManager`, `playbackService`, `DJService`, `spotifyPlayerStore`
  - Build helper functions: `makeQueueItem(spotifyTrackId, name, profileId)`, `makeFinishedState(trackId, trackName, artistName)` producing a `PlayerSDKState` where `isTrackFinished()` returns true
  - Test case 1: Basic track finish — queue has item with `profile_id: 'profile-1'` and matching `spotify_track_id`, simulate track finishing naturally — assert `addToRecentlyPlayed` is called with correct `profileId`, `spotifyTrackId`, `title`, and `artist` (will FAIL on unfixed code — never called)
  - Test case 2: Correct arguments — verify `addToRecentlyPlayed` is called with `profileId` from the queue item's `profile_id`, `spotifyTrackId` from `currentTrack.id`, `title` from `currentTrack.name`, `artist` from `currentTrack.artists[0].name` (will FAIL on unfixed code)
  - Test case 3: No queue match — simulate track finishing with no matching queue item — assert `addToRecentlyPlayed` is NOT called (no `profile_id` available). This case should PASS on unfixed code (correctly not called)
  - Test case 4: Fuzzy name match — queue item name differs from SDK name by suffix (e.g., queue: "Dirrty", SDK: "Dirrty (feat. Redman)") — assert `addToRecentlyPlayed` is still called using the matched queue item's `profile_id` (will FAIL on unfixed code)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL for cases 1, 2, 4 (this is correct — it proves the bug exists). Case 3 should PASS.
  - Document counterexamples found to understand root cause
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 2.1, 2.2_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** — Track Transition Behavior Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Create test file `services/playerLifecycle/__tests__/QueueSynchronizer.recentlyPlayed.preservation.test.ts`
  - Use `node:test` and `node:assert` (no Jest/Vitest)
  - Build the same minimal mock infrastructure as task 1
  - Observe on UNFIXED code: when a track finishes naturally, `markFinishedTrackAsPlayed()` is called with the correct track ID and name
  - Observe on UNFIXED code: when a track finishes naturally, `findNextValidTrack()` is called and its result drives `playNextTrackImpl()`
  - Observe on UNFIXED code: when `duplicateDetector.shouldProcessTrack()` returns false, the method returns early without calling `markFinishedTrackAsPlayed()`
  - Observe on UNFIXED code: `DJService.maybeAnnounce()` is called for the next track between the lookup and play phases
  - Write property-based style tests covering these observed behaviors across varied inputs (random track IDs, names, queue configurations, profile IDs)
  - Test case 1: Queue removal — verify `markFinishedTrackAsPlayed` is called with the correct `currentSpotifyTrackId` and `currentTrackName` for varied inputs
  - Test case 2: Next track selection — verify `findNextValidTrack` result drives `playNextTrackImpl` call for varied queue states
  - Test case 3: Duplicate detector early return — verify that when `shouldProcessTrack` returns false, no `markFinishedTrackAsPlayed` or playback calls occur
  - Test case 4: DJ announce — verify `DJService.maybeAnnounce()` is called with the next track before `playNextTrackImpl`
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. Fix recently played tracking

  - [x] 3.1 Implement the fix in `handleTrackFinishedImpl()`
    - Import `addToRecentlyPlayed` from `@/services/aiSuggestion` at the top of `QueueSynchronizer.ts`
    - Inside the `executePlayback` callback in `handleTrackFinishedImpl()`, BEFORE calling `markFinishedTrackAsPlayed()`, capture the finished track's queue item: look up via `queueManager.getQueue().find(item => item.tracks.spotify_track_id === currentSpotifyTrackId)` or fuzzy name match via `fuzzyTrackNameMatch`
    - After `markFinishedTrackAsPlayed()` completes (still inside the callback), if a queue item was found (has `profile_id`), call `addToRecentlyPlayed()` as fire-and-forget: `void addToRecentlyPlayed(finishedQueueItem.profile_id, { spotifyTrackId: currentSpotifyTrackId, title: currentTrack.name, artist: currentTrack.artists[0]?.name ?? 'Unknown' }).catch(() => {})`
    - If no queue item matched (no `profile_id`), skip the `addToRecentlyPlayed()` call
    - The call MUST be non-blocking (`void ... .catch(() => {})`) so Supabase failures do not block track transitions
    - Use single quotes, no semicolons, no trailing commas
    - _Bug_Condition: isBugCondition(input) where a track finishes naturally and is not recorded in recently_played_tracks_
    - _Expected_Behavior: addToRecentlyPlayed called with profileId from queue item, spotifyTrackId from currentTrack.id, title from currentTrack.name, artist from currentTrack.artists[0]?.name_
    - _Preservation: markFinishedTrackAsPlayed, findNextValidTrack, DJService.maybeAnnounce, playNextTrackImpl all behave identically_
    - _Requirements: 1.1, 2.1, 2.2, 3.1, 3.2, 3.3, 3.4_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** — Track Finish Records Recently Played
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** — Track Transition Behavior Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Checkpoint — Ensure all tests pass
  - Run full test suite to confirm no regressions
  - Ensure bug condition test (task 1) now passes
  - Ensure preservation tests (task 2) still pass
  - Ensure existing project tests still pass (song-restart-loop-fix tests, trackNameMatcher tests, etc.)
  - Ask the user if questions arise
