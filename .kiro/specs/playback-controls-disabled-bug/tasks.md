# Implementation Plan

- [-] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Controls Disabled During Track Transition
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Scope the property to the concrete failing cases — trigger `handleTrackFinished` and assert skip button is NOT disabled while `isOperationInProgress()` is true
  - Test that while `handleTrackFinishedImpl` is executing (lock held), `isActuallyPlaying` returns `true` and skip button `disabled` prop is `false`
  - Also test with DJ Mode enabled and a mocked slow `maybeAnnounce` — assert skip button `disabled` is `false` mid-announcement
  - Also test that `syncQueueWithPlayback` called with a valid playing state while `isOperationInProgress()` is `true` updates the Zustand store (does NOT early-return)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (confirms bug — `isActuallyPlaying` returns `false`, skip button is `disabled`, `syncQueueWithPlayback` discards state)
  - Document counterexamples found (e.g., "`isActuallyPlaying` returns `false` during transition because `playbackState.is_playing` is `false` in stale Zustand state")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6_

- [~] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Auto-Play, DJ Sequencing, and Race Condition Prevention Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe: after a normal track transition on unfixed code, the next track plays automatically
  - Observe: `maybeAnnounce` is called before `playNextTrackImpl` in DJ Mode on unfixed code
  - Observe: duplicate `handleTrackFinished` events for the same track are deduplicated on unfixed code
  - Observe: next track starts at 50% volume when Duck & Overlay is enabled on unfixed code
  - Write property-based tests: for any track transition (with or without DJ), the next track plays exactly once after the transition completes
  - Write property-based test: for any DJ announcement, `maybeAnnounce` is called before `playNextTrackImpl`
  - Write property-based test: for any concurrent `handleTrackFinished` events for the same track, only one transition executes
  - Verify all tests PASS on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [ ] 3. Fix for playback controls disabled during track transition

  - [~] 3.1 Add `isTransitionInProgress` flag to Zustand store
    - Add `isTransitionInProgress: boolean` field to `useSpotifyPlayerStore`, defaulting to `false`
    - Add `setIsTransitionInProgress(value: boolean): void` action to the store
    - File: `hooks/useSpotifyPlayer.ts` (or wherever the Zustand store is defined)
    - _Bug_Condition: `playbackService.isOperationInProgress() = true` AND `zustandStore.playbackState.is_playing = false` AND `zustandStore.isTransitionInProgress = false`_
    - _Expected_Behavior: `isTransitionInProgress` is `true` throughout the transition window so UI can keep controls enabled_
    - _Requirements: 2.1, 2.3_

  - [~] 3.2 Split serialized operation and set transition flag in `handleTrackFinishedImpl`
    - Set `isTransitionInProgress = true` in Zustand store at the start of `handleTrackFinishedImpl`, before the lock is acquired
    - Move `maybeAnnounce` outside the `playbackService.executePlayback()` lock (or split into two sequential `executePlayback` calls — one for lookup/mark-played, one for the actual play call)
    - Set `isTransitionInProgress = false` in a `finally` block after `playNextTrackImpl` resolves
    - File: `services/playerLifecycle/QueueSynchronizer.ts`
    - _Bug_Condition: `maybeAnnounce` awaits TTS audio inside the serialized lock, holding `isOperationInProgress() = true` for the full announcement duration_
    - _Expected_Behavior: lock is released before TTS audio plays; `isTransitionInProgress` flag covers the full transition window instead_
    - _Preservation: `maybeAnnounce` still runs before `playNextTrackImpl`; race condition deduplication via serialized queue is preserved_
    - _Requirements: 2.1, 2.4, 2.5, 3.1, 3.3, 3.4, 3.6_

  - [~] 3.3 Remove or narrow the `syncQueueWithPlayback` early-return
    - Update `syncQueueWithPlayback` in `QueueSynchronizer.ts` to allow Zustand state updates to pass through even when `isOperationInProgress()` is `true`
    - Only block the queue-enforcement branch (if needed), not the `onPlaybackStateChange` / Zustand update path
    - File: `services/playerLifecycle/QueueSynchronizer.ts`
    - _Bug_Condition: `syncQueueWithPlayback` returns early for ALL SDK events when `isOperationInProgress()` is `true`, discarding state updates_
    - _Expected_Behavior: Zustand `playbackState` is updated from incoming SDK events even during a transition_
    - _Requirements: 2.2, 3.6_

  - [~] 3.4 Update `getIsActuallyPlaying` to be transition-aware
    - Update `getIsActuallyPlaying` in `app/[username]/admin/hooks/usePlaybackControls.ts` to return `true` when `isTransitionInProgress` is `true`
    - This ensures `disabled={!isReady || !isActuallyPlaying || isSkipLoading}` evaluates to `false` (enabled) during transitions
    - File: `app/[username]/admin/hooks/usePlaybackControls.ts`
    - _Bug_Condition: `getIsActuallyPlaying()` returns `false` when `playbackState.is_playing` is `false` with no transition-aware fallback_
    - _Expected_Behavior: `getIsActuallyPlaying()` returns `true` when `isTransitionInProgress` is `true`, keeping skip and play buttons enabled_
    - _Requirements: 2.1, 2.3, 2.5_

  - [~] 3.5 Add DJ status indicator in jukebox section
    - When `isTransitionInProgress` is `true` and DJ Mode is enabled, render a "DJ is speaking..." status label in `jukebox-section.tsx`
    - File: `app/[username]/admin/components/dashboard/components/jukebox-section.tsx`
    - _Expected_Behavior: user sees a visual indicator explaining why no track is actively playing in Spotify during a DJ announcement_
    - _Requirements: 2.6_

  - [~] 3.6 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Controls Remain Enabled During Track Transition
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms skip button is NOT disabled during transitions and `syncQueueWithPlayback` no longer discards state
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [~] 3.7 Verify preservation tests still pass
    - **Property 2: Preservation** - Auto-Play, DJ Sequencing, and Race Condition Prevention Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions in auto-play, DJ sequencing, Duck & Overlay, and race condition prevention)
    - Confirm all tests still pass after fix (no regressions)

- [~] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
