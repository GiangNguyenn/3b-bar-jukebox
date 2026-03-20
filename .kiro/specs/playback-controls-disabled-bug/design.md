# Playback Controls Disabled Bug — Bugfix Design

## Overview

During every track transition, the skip button, play/pause button, and progress bar become
disabled and unresponsive. The window is near-zero milliseconds for normal transitions but
extends to several seconds when DJ Mode is active. The fix has two parts:

1. Move `maybeAnnounce` (DJ audio) **outside** the serialized `playbackService` operation so
   the lock is released before TTS audio plays.
2. Introduce a `isTransitionInProgress` flag in the Zustand store so the UI can show a
   "transitioning" state instead of deriving `isActuallyPlaying = false` from stale SDK state,
   keeping controls enabled throughout the transition window.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — `playbackService.isOperationInProgress()` is `true` while the Zustand `playbackState` is stale (ended-track state with `is_playing: false`), causing `isActuallyPlaying` to return `false`.
- **Property (P)**: The desired behavior — skip button, play button, and progress bar remain enabled and interactive throughout any track transition.
- **Preservation**: Existing auto-play, DJ announcement, Duck & Overlay, and race-condition-prevention behaviors that must remain unchanged by the fix.
- **`handleTrackFinishedImpl`**: Private method in `services/playerLifecycle/QueueSynchronizer.ts` that orchestrates the full track transition (mark played → find next → DJ announce → play next), currently running entirely inside a single `playbackService.executePlayback()` call.
- **`syncQueueWithPlayback`**: Method in `QueueSynchronizer.ts` that early-returns when `playbackService.isOperationInProgress()` is `true`, discarding all incoming SDK state events during the transition.
- **`transformStateForUI`**: Private method in `services/playerLifecycle.ts` that converts a raw `PlayerSDKState` to `SpotifyPlaybackState`. Returns `null` when the SDK emits the finished-track state (paused=true, no valid current track), preventing `onPlaybackStateChange` from updating the Zustand store.
- **`isActuallyPlaying`**: Derived boolean in `usePlaybackControls.ts` — `playbackState?.is_playing ?? false`. Drives `disabled={!isReady || !isActuallyPlaying || isSkipLoading}` on the skip button.
- **`playbackService`**: Singleton `PlaybackService` in `services/player/playbackService.ts` that serializes operations via a promise chain. `isOperationInProgress()` returns `true` while `pendingOperations > 0`.
- **`isTransitionInProgress`**: New boolean flag to be added to the Zustand `useSpotifyPlayerStore`, set to `true` when a track transition begins and `false` when the next track starts playing.

## Bug Details

### Bug Condition

The bug manifests on every track transition. `handleTrackFinishedImpl` runs inside a single
`playbackService.executePlayback()` call that holds `isOperationInProgress() = true` for the
entire duration — including `findNextValidTrack`, `maybeAnnounce` (DJ TTS audio), and
`playNextTrackImpl`. While that flag is set, `syncQueueWithPlayback` returns early, discarding
all SDK state events. The finished-track SDK state (paused=true, position=0) causes
`transformStateForUI` to return `null`, so `onPlaybackStateChange` is never called and
`playbackState` in Zustand goes stale with `is_playing: false`. `isActuallyPlaying` reads
`false`, locking the skip button.

**Formal Specification:**
```
FUNCTION isBugCondition(state)
  INPUT: state — current application state snapshot
  OUTPUT: boolean

  RETURN playbackService.isOperationInProgress() = true
         AND zustandStore.playbackState.is_playing = false   // stale ended-track state
         AND zustandStore.isTransitionInProgress = false      // no transition flag set
END FUNCTION
```

### Examples

- **Normal transition (no DJ)**: Track ends → `handleTrackFinishedImpl` starts → lock held ~200–500 ms → skip button disabled for that window → next track starts → lock released.
- **DJ Mode transition**: Track ends → `handleTrackFinishedImpl` starts → DJ TTS fetched and played (2–8 s) → skip button disabled for entire announcement → next track starts → lock released.
- **User tries to skip during DJ announcement**: Skip button is `disabled` → click is ignored → user cannot interrupt the announcement.
- **Progress bar disappears**: `currentlyPlaying?.item` is `null` during transition (20-second poll hasn't fired yet) → progress bar and track info section unmount.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Auto-play: when a track finishes, the next track in the queue plays automatically without user interaction.
- DJ announcement sequencing: `maybeAnnounce` still runs before `playNextTrackImpl`; the next track still starts after the announcement completes (or immediately if no announcement).
- Duck & Overlay: next track still starts at 50% volume with ramp-up when Duck & Overlay is enabled.
- Race condition prevention: concurrent `handleTrackFinished` events for the same track are still deduplicated; the serialized operation queue still prevents concurrent `playNextTrackImpl` calls.
- DJ graceful fallback: if `maybeAnnounce` fails for any reason, the next track still plays.
- Normal `isActuallyPlaying` behavior: when a track is actively playing with no transition in progress, `isActuallyPlaying` continues to be driven by `playbackState.is_playing`.

**Scope:**
All inputs that do NOT involve a track transition (i.e., `isBugCondition` returns false) must be completely unaffected. This includes:
- Normal play/pause while a track is playing.
- Volume changes.
- Seeking on the progress bar.
- DJ Mode toggle, frequency, and Duck & Overlay settings.

## Hypothesized Root Cause

Based on the bug description and code analysis:

1. **`maybeAnnounce` inside the serialized lock**: `handleTrackFinishedImpl` is wrapped in a single `playbackService.executePlayback()` call. `maybeAnnounce` awaits TTS audio playback (potentially several seconds) inside that same call, holding `pendingOperations > 0` for the full duration. Moving `maybeAnnounce` outside the lock (or splitting the operation into two serialized steps) eliminates the extended lock window.

2. **`syncQueueWithPlayback` early-return discards SDK events**: The guard `if (playbackService.isOperationInProgress()) return` was designed to prevent race conditions but has the side effect of dropping all SDK state updates during the transition. The Zustand store never receives the new track's playing state until the lock is released.

3. **`transformStateForUI` returns `null` for finished-track state**: When the SDK emits `paused=true, position=0` (track ended), `transformStateForUI` returns `null` because `is_playing: false` with no valid current track. `onPlaybackStateChange` is not called, so `playbackState` stays stale.

4. **`isActuallyPlaying` has no transition-aware fallback**: `getIsActuallyPlaying()` returns `false` when `playbackState` is null or `is_playing` is false, with no awareness that a transition is in progress. Adding an `isTransitionInProgress` flag allows the UI to keep controls enabled during the gap.

5. **Progress bar depends on 20-second poll**: `currentlyPlaying` in `jukebox-section.tsx` comes from `useNowPlayingTrack` with `refetchInterval: 20000`. During the transition window, `currentlyPlaying?.item` is null, so the progress bar section unmounts. This is a secondary symptom resolved by the `isTransitionInProgress` flag allowing the UI to show a loading/transitioning state.

## Correctness Properties

Property 1: Bug Condition — Controls Remain Enabled During Transition

_For any_ track transition where `handleTrackFinishedImpl` is executing, the skip button and
play/pause button SHALL remain enabled (not `disabled`) throughout the transition window,
including while a DJ announcement is playing.

**Validates: Requirements 2.1, 2.3, 2.4, 2.5**

Property 2: Preservation — Auto-Play and DJ Sequencing Unchanged

_For any_ track transition where the bug condition does NOT hold (no transition in progress),
the fixed code SHALL produce exactly the same auto-play behavior, DJ announcement sequencing,
Duck & Overlay volume behavior, and race-condition prevention as the original code.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File 1**: `services/playerLifecycle/QueueSynchronizer.ts`

**Function**: `handleTrackFinishedImpl`

**Specific Changes**:
1. **Split the serialized operation**: Wrap only the Spotify API call (`playNextTrackImpl`) inside `playbackService.executePlayback()`. Move `findNextValidTrack` and `maybeAnnounce` outside the lock, or use two sequential `executePlayback` calls — one for the lookup/mark-played step and one for the actual play call.
2. **Set `isTransitionInProgress = true`** in the Zustand store at the start of `handleTrackFinishedImpl`, before the lock is acquired.
3. **Set `isTransitionInProgress = false`** after `playNextTrackImpl` resolves (in a `finally` block to handle errors).
4. **Remove or narrow the `syncQueueWithPlayback` early-return**: Instead of returning early for all SDK events when `isOperationInProgress()`, allow state updates to pass through (or only block the queue-enforcement branch, not the Zustand state update).

**File 2**: `hooks/useSpotifyPlayer.ts` (or wherever the Zustand store is defined)

**Specific Changes**:
1. **Add `isTransitionInProgress: boolean`** field to the store, defaulting to `false`.
2. **Add `setIsTransitionInProgress(value: boolean): void`** action.

**File 3**: `app/[username]/admin/hooks/usePlaybackControls.ts`

**Specific Changes**:
1. **Update `getIsActuallyPlaying`**: Return `true` (or a new `isTransitioning` state) when `isTransitionInProgress` is `true`, so the skip button is not disabled during transitions.

**File 4**: `app/[username]/admin/components/dashboard/components/jukebox-section.tsx`

**Specific Changes**:
1. **Show DJ status indicator**: When `isTransitionInProgress` is `true` and DJ Mode is enabled, render a "DJ is speaking..." status label so the user understands why no track is actively playing in Spotify (Requirement 2.6).

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that
demonstrate the bug on unfixed code, then verify the fix works correctly and preserves
existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix.
Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that simulate a track-finished event and assert that the skip
button remains enabled while `handleTrackFinishedImpl` is executing. Run these tests on the
UNFIXED code to observe failures and understand the root cause.

**Test Cases**:
1. **Skip button disabled during normal transition** (will fail on unfixed code): Trigger `handleTrackFinished`, immediately check `isActuallyPlaying` — expect `true`, observe `false`.
2. **Skip button disabled during DJ announcement** (will fail on unfixed code): Trigger `handleTrackFinished` with DJ Mode enabled and a mocked slow `maybeAnnounce`, check skip button `disabled` prop mid-announcement — expect `false`, observe `true`.
3. **`syncQueueWithPlayback` discards state during lock** (will fail on unfixed code): While `isOperationInProgress()` is `true`, call `syncQueueWithPlayback` with a valid playing state — expect Zustand store to update, observe early return with no update.
4. **Progress bar disappears during transition** (will fail on unfixed code): Trigger transition, check `currentlyPlaying?.item` — expect non-null or loading indicator, observe null causing unmount.

**Expected Counterexamples**:
- `isActuallyPlaying` returns `false` during transition because `playbackState.is_playing` is `false` in stale Zustand state.
- Possible causes: `syncQueueWithPlayback` early-return, `transformStateForUI` returning `null`, no transition-aware fallback in `getIsActuallyPlaying`.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed code produces
the expected behavior (controls remain enabled).

**Pseudocode:**
```
FOR ALL state WHERE isBugCondition(state) DO
  result := observeSkipButtonDisabledProp(state)
  ASSERT result = false   // skip button is NOT disabled
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed code
produces the same result as the original code.

**Pseudocode:**
```
FOR ALL state WHERE NOT isBugCondition(state) DO
  ASSERT original_behavior(state) = fixed_behavior(state)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many track/state combinations automatically.
- It catches edge cases (empty queue, DJ disabled, Duck & Overlay on/off) that manual tests miss.
- It provides strong guarantees that auto-play and DJ sequencing are unchanged.

**Test Plan**: Observe behavior on UNFIXED code first for normal auto-play and DJ flows,
then write property-based tests capturing that behavior.

**Test Cases**:
1. **Auto-play preservation**: Verify next track plays automatically after transition completes.
2. **DJ sequencing preservation**: Verify `maybeAnnounce` still runs before `playNextTrackImpl`.
3. **Duck & Overlay preservation**: Verify volume is 50% at next-track start when Duck & Overlay is enabled.
4. **Race condition prevention**: Verify duplicate `handleTrackFinished` events for the same track are still deduplicated.

### Unit Tests

- `handleTrackFinishedImpl` sets `isTransitionInProgress = true` at start and `false` after `playNextTrackImpl`.
- `syncQueueWithPlayback` does NOT discard Zustand state updates when `isOperationInProgress()` is `true` (after fix).
- `getIsActuallyPlaying` returns `true` when `isTransitionInProgress` is `true`.
- Skip button is not `disabled` when `isTransitionInProgress` is `true`.
- `maybeAnnounce` is called before `playNextTrackImpl` (sequencing preserved).

### Property-Based Tests

- For any track transition, `isTransitionInProgress` is `true` between `handleTrackFinished` start and `playNextTrackImpl` completion, and `false` at all other times.
- For any track transition (with or without DJ), the next track plays exactly once after the transition.
- For any DJ announcement (any duration), the skip button `disabled` prop is `false` throughout the announcement.

### Integration Tests

- Full track transition with DJ Mode disabled: controls stay enabled, next track plays.
- Full track transition with DJ Mode enabled: controls stay enabled during announcement, "DJ is speaking..." indicator shown, next track plays after announcement.
- User clicks skip during DJ announcement: skip is processed, announcement is interrupted, next-next track plays.
- Duck & Overlay: next track starts at 50% volume, ramps to 100% after announcement.
