# Song Restart Loop Fix — Bugfix Design

## Overview

A playing track restarts in an infinite loop (~20 s cycle) because `syncQueueWithPlayback()` in `QueueSynchronizer` cannot match the Spotify SDK's track ID to any queue item. When the exact-ID lookup fails and the existing case-sensitive name comparison also fails (e.g., Spotify returns "Dirrty (feat. Redman)" while the queue stores "Dirrty"), `syncQueueWithPlayback()` calls `playNextTrack()` which restarts the same track. Each restart fires a new SDK state change, re-entering `syncQueueWithPlayback()`, perpetuating the loop. The fix introduces robust fuzzy track-name matching, a "last force-played" guard to prevent repeated `playNextTrack()` calls for the same track, deduplication logging in `DJService.onTrackStarted()`, and diagnostic logging when matches fail.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the restart loop — `syncQueueWithPlayback()` finds no queue match (neither exact ID nor fuzzy name) for the currently playing Spotify track and calls `playNextTrack()` repeatedly
- **Property (P)**: The desired behavior — robust fuzzy matching prevents false mismatches, and a force-play guard prevents repeated `playNextTrack()` calls for the same track
- **Preservation**: Normal track transitions, exact-ID matching, queue enforcement for genuinely wrong tracks, DJ prefetch, and AutoPlayService polling must remain unchanged
- **syncQueueWithPlayback()**: Method in `QueueSynchronizer` (`services/playerLifecycle/QueueSynchronizer.ts`) that reconciles the Spotify SDK's currently-playing track with the jukebox queue
- **playNextTrack()**: Method in `QueueSynchronizer` that force-starts a track via the Spotify API, triggering `onTrackStarted()` in DJService
- **Track Relinking**: Spotify feature where the same song may have different track IDs across regions/versions, causing ID mismatches between what was queued and what the SDK reports as playing
- **Fuzzy Match**: A name comparison that normalizes case, strips parenthetical suffixes like "(feat. X)" or "(Remastered)", and compares base track names

## Bug Details

### Bug Condition

The bug manifests when `syncQueueWithPlayback()` runs for a currently-playing track whose Spotify ID does not exactly match any queue item's `spotify_track_id`, AND the existing case-sensitive name comparison also fails due to metadata differences (parenthetical suffixes, featuring artist variations, remaster tags). This causes `playNextTrack()` to be called, which restarts the same track, generating a new SDK state change that re-enters `syncQueueWithPlayback()` — creating an infinite loop.

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT: input of type { sdkState: PlayerSDKState, queue: JukeboxQueueItem[], currentQueueTrack: JukeboxQueueItem | null }
  OUTPUT: boolean

  LET spotifyTrack = input.sdkState.track_window.current_track
  LET exactMatch = input.queue.find(item => item.tracks.spotify_track_id === spotifyTrack.id)

  IF exactMatch THEN RETURN false  // Exact ID match — no bug

  LET expectedTrack = input.currentQueueTrack OR input.queue[0]
  LET currentNameMatch = expectedTrack.tracks.name.toLowerCase() === spotifyTrack.name.toLowerCase()

  IF currentNameMatch THEN RETURN false  // Current fuzzy match catches it — no bug

  // Bug condition: no exact match, current fuzzy match fails, but a ROBUST fuzzy match WOULD succeed
  LET robustMatch = fuzzyTrackNameMatch(expectedTrack.tracks.name, spotifyTrack.name)

  RETURN robustMatch = true  // The track IS the same song, but the system doesn't recognize it
         AND input.queue.length > 0
         AND NOT input.sdkState.paused
END FUNCTION
```

### Examples

- **"Dirrty (feat. Redman)" vs "Dirrty"**: Queue stores "Dirrty", Spotify SDK reports "Dirrty (feat. Redman)". Exact ID fails (relinked). Case-sensitive `toLowerCase()` comparison fails because strings differ. System calls `playNextTrack()`, restarting the song. With robust fuzzy matching, the base names match and no restart occurs.
- **"Bohemian Rhapsody - Remastered 2011" vs "Bohemian Rhapsody"**: Queue stores the original name, Spotify returns the remastered variant. Same song, different metadata suffix. Current matching fails; robust matching would strip the suffix and match.
- **"Don't Stop Me Now (2011 Remaster)" vs "Don't Stop Me Now"**: Parenthetical remaster tag causes mismatch with current exact-lowercase comparison.
- **Legitimate mismatch — different song entirely**: Queue expects "Bohemian Rhapsody" but Spotify plays "We Will Rock You". Neither exact ID nor fuzzy name matches. System correctly calls `playNextTrack()` to enforce queue order — this behavior must be preserved.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- Exact Spotify track ID matches continue to update `currentQueueTrack` and `setCurrentlyPlayingTrack` without calling `playNextTrack()`
- Natural track transitions (track finishes → next track starts) continue to call `onTrackStarted()` and trigger DJ prefetch
- Queue enforcement for genuinely mismatched tracks (completely different song playing) continues to call `playNextTrack()` with the expected track
- Empty queue handling continues to set `currentlyPlayingTrack` to null
- `AutoPlayService` polling, track-finished detection, auto-fill, and interval adjustment remain unchanged
- `playNextTrackImpl()` continues to call `DJService.onTrackStarted()`, upsert played tracks, and update queue manager state on first successful play

**Scope:**
All inputs where the Spotify track ID exactly matches a queue item, or where the queue is empty, or where a genuinely different track is playing, should be completely unaffected by this fix. The fix only changes behavior for:

- Track name comparison logic (more robust fuzzy matching)
- Repeated `playNextTrack()` calls for the same track (force-play guard)
- `onTrackStarted()` logging (deduplication)
- Diagnostic logging when matches fail

## Hypothesized Root Cause

Based on the bug description and code analysis, the root causes are:

1. **Insufficient Fuzzy Matching in `syncQueueWithPlayback()`**: The current fuzzy match at line 339-341 of `QueueSynchronizer.ts` uses a simple `toLowerCase()` comparison: `expectedTrack.tracks.name.toLowerCase() === currentSpotifyTrack.name.toLowerCase()`. This fails when Spotify returns track names with additional metadata like "(feat. Redman)", "- Remastered 2011", or "(Deluxe Edition)" that the queue's stored name doesn't include. The comparison needs to normalize parenthetical suffixes, featuring artist tags, and remaster annotations.

2. **No Force-Play Guard**: When `syncQueueWithPlayback()` calls `playNextTrack(expectedTrack)` and the track restarts, the next SDK state change re-enters `syncQueueWithPlayback()` which again fails to match and calls `playNextTrack()` again. There is no mechanism to remember that we already force-played a specific track and should not do it again.

3. **DJService `onTrackStarted()` Lacks Deduplication**: Each `playNextTrack()` call in the loop triggers `onTrackStarted()` in DJService, which logs a full roll/threshold line every time. There is no check for whether the same track was already announced, creating log clutter that obscures the real problem.

4. **No Diagnostic Logging on Match Failure**: When `syncQueueWithPlayback()` decides to call `playNextTrack()`, it does not log which IDs were compared, what the track names were, or why the fuzzy match failed. This makes it very difficult to diagnose the root cause from logs alone.

## Correctness Properties

Property 1: Bug Condition — Robust Fuzzy Matching Prevents False Restarts

_For any_ SDK state where the Spotify track ID does not exactly match any queue item but the track name is a fuzzy match (after normalizing case, parenthetical suffixes, featuring artist tags, and remaster annotations), the fixed `syncQueueWithPlayback()` SHALL treat the track as matched and NOT call `playNextTrack()`.

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation — Exact Match and Queue Enforcement Unchanged

_For any_ SDK state where the Spotify track ID exactly matches a queue item, OR where the queue is empty, OR where a genuinely different track is playing (no fuzzy name match), the fixed `syncQueueWithPlayback()` SHALL produce the same behavior as the original function — updating `currentQueueTrack` for exact matches, returning early for empty queues, and calling `playNextTrack()` for genuine mismatches.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `shared/utils/trackNameMatcher.ts` (new)

**Purpose**: Robust fuzzy track name matching utility

**Specific Changes**:

1. **`normalizeTrackName(name: string): string`**: Strip parenthetical suffixes like "(feat. X)", "(Remastered 2011)", "(Deluxe Edition)", "- Remastered", etc. Convert to lowercase. Trim whitespace.
2. **`fuzzyTrackNameMatch(queueName: string, spotifyName: string): boolean`**: Compare normalized versions of both names. Return true if the base track names match after normalization.

---

**File**: `services/playerLifecycle/QueueSynchronizer.ts`

**Function**: `syncQueueWithPlayback()`

**Specific Changes**:

1. **Replace simple `toLowerCase()` comparison with `fuzzyTrackNameMatch()`**: Import and use the new utility for the track relinking check, so names like "Dirrty" and "Dirrty (feat. Redman)" are recognized as the same track.
2. **Add force-play guard**: Track the last force-played Spotify track ID in a new private field `lastForcePlayedTrackId: string | null`. Before calling `playNextTrack()`, check if `currentSpotifyTrack.id === this.lastForcePlayedTrackId`. If so, skip the call. Set the field when `playNextTrack()` is called; clear it when a different track starts playing or an exact match is found.
3. **Add diagnostic logging**: When the match fails and `playNextTrack()` is about to be called, log the Spotify track ID, expected queue track ID, both track names, and the fuzzy match result using `this.controller.log()`.

---

**File**: `services/playerLifecycle/QueueSynchronizer.ts`

**Function**: `playNextTrackImpl()`

**Specific Changes**: 4. **Update force-play guard on successful play**: After a successful `playTrackWithRetry()`, set `lastForcePlayedTrackId` to the track's `spotify_track_id` so that `syncQueueWithPlayback()` won't re-trigger for this track.

---

**File**: `services/djService.ts`

**Function**: `onTrackStarted()`

**Specific Changes**: 5. **Add deduplication for repeated calls**: Track the last track ID that `onTrackStarted()` was called for in a new private field `lastOnTrackStartedId: string | null`. If called again for the same `_currentTrack.id`, log a single concise deduplication message instead of the full roll/threshold log line, and return early (skip prefetch logic).

---

**File**: `services/playerLifecycle/QueueSynchronizer.ts`

**Function**: `markFinishedTrackAsPlayed()`

**Specific Changes**: 6. **Use `fuzzyTrackNameMatch()` for fallback matching**: Replace the existing `item.tracks.name.toLowerCase() === trackName.toLowerCase()` comparison with `fuzzyTrackNameMatch()` for consistency.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write unit tests that call `syncQueueWithPlayback()` with SDK states where the track ID doesn't match any queue item but the track name is a fuzzy match (with parenthetical suffixes). Run these tests on the UNFIXED code to observe that `playNextTrack()` is called (demonstrating the bug).

**Test Cases**:

1. **Featuring Artist Suffix Test**: SDK reports "Dirrty (feat. Redman)", queue has "Dirrty" — `playNextTrack()` should NOT be called but WILL be on unfixed code
2. **Remaster Suffix Test**: SDK reports "Bohemian Rhapsody - Remastered 2011", queue has "Bohemian Rhapsody" — will fail on unfixed code
3. **Repeated Force-Play Test**: Call `syncQueueWithPlayback()` twice with the same mismatched state — `playNextTrack()` should only be called once but WILL be called twice on unfixed code
4. **DJService Deduplication Test**: Call `onTrackStarted()` twice for the same track — should log deduplication message but WON'T on unfixed code

**Expected Counterexamples**:

- `playNextTrack()` is called for tracks that are actually the same song with different metadata
- `playNextTrack()` is called repeatedly for the same track on consecutive state changes
- `onTrackStarted()` logs full roll/threshold details for every repeated call

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**

```
FOR ALL input WHERE isBugCondition(input) DO
  result := syncQueueWithPlayback_fixed(input.sdkState)
  ASSERT playNextTrack was NOT called
  ASSERT queueManager.setCurrentlyPlayingTrack was called with the SDK track ID
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**

```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT syncQueueWithPlayback_original(input) = syncQueueWithPlayback_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:

- It generates many test cases automatically across the input domain (random track names, IDs, queue configurations)
- It catches edge cases that manual unit tests might miss (empty names, special characters, very long names)
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for exact-match inputs and genuine-mismatch inputs, then write property-based tests capturing that behavior.

**Test Cases**:

1. **Exact ID Match Preservation**: Verify that when Spotify track ID matches a queue item, `currentQueueTrack` is updated and `playNextTrack()` is NOT called — same behavior before and after fix
2. **Empty Queue Preservation**: Verify that when queue is empty, `currentlyPlayingTrack` is set to null — same behavior before and after fix
3. **Genuine Mismatch Preservation**: Verify that when a completely different track is playing (no fuzzy name match), `playNextTrack()` IS called — same behavior before and after fix
4. **Paused State Preservation**: Verify that when playback is paused, `currentlyPlayingTrack` is set to null and no queue enforcement occurs — same behavior before and after fix

### Unit Tests

- Test `normalizeTrackName()` with various suffixes: "(feat. X)", "(Remastered)", "- Deluxe Edition", "(Live)", mixed case
- Test `fuzzyTrackNameMatch()` with matching and non-matching pairs
- Test `syncQueueWithPlayback()` force-play guard prevents repeated calls
- Test `onTrackStarted()` deduplication skips prefetch on repeated calls
- Test `markFinishedTrackAsPlayed()` uses fuzzy matching for fallback

### Property-Based Tests

- Generate random track names with random parenthetical suffixes appended, verify `fuzzyTrackNameMatch(base, base + suffix)` returns true
- Generate random pairs of completely different track names, verify `fuzzyTrackNameMatch(a, b)` returns false
- Generate random queue states with exact ID matches, verify `syncQueueWithPlayback()` never calls `playNextTrack()`

### Integration Tests

- Test full `syncQueueWithPlayback()` → `playNextTrack()` → `onTrackStarted()` flow with a relinked track to verify no restart loop
- Test that after a force-play guard triggers, a genuine track change (different song) still correctly calls `playNextTrack()`
- Test that `AutoPlayService` polling with a fuzzy-matched track does not cause additional `playNextTrack()` calls
