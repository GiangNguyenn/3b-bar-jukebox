# Recently Played Tracking Fix — Bugfix Design

## Overview

The `recently_played_tracks` table is never populated when tracks finish playing naturally. `QueueSynchronizer.handleTrackFinishedImpl()` calls `markFinishedTrackAsPlayed()` which only removes the track from the queue — it never calls `addToRecentlyPlayed()`. The only invocation of `addToRecentlyPlayed()` is in the `/api/ai-suggestions` route, where it records AI-returned tracks (not actually-played tracks). As a result, `getRecentlyPlayed()` always returns empty, and the AI auto-fill feature has no exclusion data — causing it to re-suggest songs that were already played. The fix adds a fire-and-forget `addToRecentlyPlayed()` call inside `handleTrackFinishedImpl()` after the track is marked as played, using the track metadata available from the `PlayerSDKState` and the queue item's `profile_id`.

## Glossary

- **Bug_Condition (C)**: A track finishes playing naturally (detected by `handleTrackFinishedImpl`) and the system does NOT record it in the `recently_played_tracks` table
- **Property (P)**: After a track finishes playing, it SHALL be recorded in `recently_played_tracks` via `addToRecentlyPlayed()` so that future AI suggestions can exclude it
- **Preservation**: Existing queue removal via `markFinishedTrackAsPlayed()`, track transitions, AI-suggestions route behavior, and non-natural-finish code paths must remain unchanged
- **handleTrackFinishedImpl()**: Private method in `QueueSynchronizer` (`services/playerLifecycle/QueueSynchronizer.ts`) that handles natural track completion — marks the track as played, finds the next track, and starts playback
- **markFinishedTrackAsPlayed()**: Method in `QueueSynchronizer` that removes a finished track from the queue via `queueManager.markAsPlayed()`
- **addToRecentlyPlayed()**: Function in `services/aiSuggestion.ts` that upserts a track into the `recently_played_tracks` Supabase table with a `played_at` timestamp
- **getRecentlyPlayed()**: Function in `services/aiSuggestion.ts` that reads the most recent 100 entries from `recently_played_tracks` for a given profile
- **PlayerSDKState**: Type representing Spotify SDK playback state, containing `track_window.current_track` with `id`, `name`, and `artists` metadata
- **JukeboxQueueItem**: Queue item type containing `profile_id` (venue owner UUID) and `tracks` (with `spotify_track_id`, `name`, `artist`)

## Bug Details

### Bug Condition

The bug manifests when a track finishes playing naturally and `handleTrackFinishedImpl()` processes the completion. The method calls `markFinishedTrackAsPlayed()` to remove the track from the queue, but never calls `addToRecentlyPlayed()` to record the track in the `recently_played_tracks` table. The track metadata (spotify_track_id, name, artist) is available from the `PlayerSDKState.track_window.current_track`, and the `profile_id` is available from the matched queue item — but neither is used to write a recently-played record.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { state: PlayerSDKState, queue: JukeboxQueueItem[] }
  OUTPUT: boolean

  LET currentTrack = input.state.track_window.current_track
  IF currentTrack IS NULL THEN RETURN false

  LET finishedQueueItem = input.queue.find(item => item.tracks.spotify_track_id === currentTrack.id)
         OR fuzzyNameMatch(input.queue, currentTrack.name)

  RETURN currentTrack.id IS NOT NULL
         AND trackHasFinishedNaturally(input.state)
         AND NOT recentlyPlayedTableContains(currentTrack.id)
END FUNCTION
```

### Examples

- **Normal track finish**: Track "Bohemian Rhapsody" (ID: `abc123`) finishes playing. `markFinishedTrackAsPlayed()` removes it from the queue. `getRecentlyPlayed()` still returns `[]` because `addToRecentlyPlayed()` was never called. Next AI auto-fill may re-suggest "Bohemian Rhapsody".
- **Multiple tracks finish in sequence**: Tracks A, B, C finish over 15 minutes. All are removed from the queue. `getRecentlyPlayed()` returns `[]`. AI auto-fill has zero exclusion data and may suggest all three again.
- **AI-suggested track finish**: A track originally added by AI auto-fill finishes playing. It was recorded in `recently_played_tracks` when the AI route returned it (not when it actually played). The `played_at` timestamp is wrong (suggestion time, not play time), and if the track was suggested but never played (e.g., skipped), it would still appear as "recently played".
- **Track with no queue match**: A track finishes but cannot be found in the queue (edge case). `markFinishedTrackAsPlayed()` handles this via fuzzy matching. The recently-played write should still attempt using SDK metadata if a `profile_id` can be resolved from the queue.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- `markFinishedTrackAsPlayed()` continues to remove the finished track from the queue via `queueManager.markAsPlayed()`
- Track transitions (find next track → DJ announce → play next) continue to work identically
- The existing `addToRecentlyPlayed()` fire-and-forget calls in `/api/ai-suggestions` route remain unchanged
- `playNextTrack()` / `playNextTrackImpl()` behavior is completely unaffected
- Manual skips and force-plays via `playNextTrack()` do not trigger recently-played writes (no change to those paths)
- `syncQueueWithPlayback()` behavior is completely unaffected
- If `addToRecentlyPlayed()` throws or the Supabase write fails, the track transition completes normally — the write is non-critical

**Scope:**
All inputs that do NOT involve a track finishing naturally via `handleTrackFinishedImpl()` should be completely unaffected by this fix. This includes:
- Manual track skips
- Queue enforcement via `syncQueueWithPlayback()`
- `playNextTrack()` calls from any source
- AI suggestion route behavior
- AutoPlayService polling and auto-fill

## Hypothesized Root Cause

Based on the bug description and code analysis, the root cause is:

1. **Missing `addToRecentlyPlayed()` call in `handleTrackFinishedImpl()`**: The method at lines 207–252 of `QueueSynchronizer.ts` handles natural track completion. Inside the `executePlayback` callback, it calls `markFinishedTrackAsPlayed()` and `findNextValidTrack()`, but never calls `addToRecentlyPlayed()`. This is the only code path that runs when a track finishes naturally, so the `recently_played_tracks` table is never populated from actual playback.

2. **Misplaced `addToRecentlyPlayed()` in AI route**: The `/api/ai-suggestions` route calls `addToRecentlyPlayed()` for tracks returned by the AI — not for tracks that were actually played. This means the recently-played data reflects "suggested" tracks rather than "played" tracks, which is semantically incorrect for exclusion purposes.

3. **No `profile_id` readily available in `QueueSynchronizer`**: The `QueueSynchronizer` class doesn't store a `profile_id` field, but the queue items themselves contain `profile_id`. When a track finishes, the matched `finishedQueueItem` (found by `markFinishedTrackAsPlayed()`) has the `profile_id` needed for the `addToRecentlyPlayed()` call. The fix needs to extract this from the queue item before it's removed.

## Correctness Properties

Property 1: Bug Condition - Recently Played Recording on Track Finish

_For any_ track that finishes playing naturally (detected by `handleTrackFinishedImpl`), where the track exists in the queue and has a valid `profile_id`, the fixed `handleTrackFinishedImpl` SHALL call `addToRecentlyPlayed()` with the correct `profile_id`, `spotify_track_id`, track `name`, and `artist`, so that the track is recorded in the `recently_played_tracks` table.

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation - Track Transition Behavior Unchanged

_For any_ track finish event, the fixed `handleTrackFinishedImpl` SHALL continue to remove the track from the queue via `markFinishedTrackAsPlayed()`, find the next valid track, announce via DJService, and start playback — producing the same observable track-transition behavior as the original function, regardless of whether `addToRecentlyPlayed()` succeeds or fails.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `services/playerLifecycle/QueueSynchronizer.ts`

**Function**: `handleTrackFinishedImpl()`

**Specific Changes**:
1. **Capture queue item before removal**: Before calling `markFinishedTrackAsPlayed()`, look up the finished track's queue item to extract `profile_id`. The queue item can be found using `queueManager.getQueue().find(item => item.tracks.spotify_track_id === currentSpotifyTrackId)` or by fuzzy name match (same logic `markFinishedTrackAsPlayed` uses internally).

2. **Add `addToRecentlyPlayed()` call**: After `markFinishedTrackAsPlayed()` completes (still inside the `executePlayback` callback), call `addToRecentlyPlayed()` as fire-and-forget using `void ... .catch(() => {})`. Use the `profile_id` from the captured queue item, `currentSpotifyTrackId` for the track ID, `currentTrack.name` for the title, and `currentTrack.artists[0]?.name` for the artist.

3. **Import `addToRecentlyPlayed`**: Add import for `addToRecentlyPlayed` from `@/services/aiSuggestion` at the top of the file.

4. **Handle edge case — no queue match**: If the finished track cannot be found in the queue (no exact ID match and no fuzzy name match), skip the `addToRecentlyPlayed()` call since there is no `profile_id` available. This is a rare edge case and acceptable to miss.

5. **Non-blocking, non-critical**: The `addToRecentlyPlayed()` call MUST be fire-and-forget (`void ... .catch(() => {})`) so that a Supabase failure does not block or crash the track transition. This matches the pattern used in the `/api/ai-suggestions` route.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that mock `addToRecentlyPlayed` and call `handleTrackFinished()` with a valid SDK state representing a naturally finished track. Assert that `addToRecentlyPlayed` is called. Run these tests on the UNFIXED code to observe failures (it won't be called).

**Test Cases**:
1. **Basic Track Finish Test**: Simulate a track finishing naturally with a matching queue item — `addToRecentlyPlayed` should be called but WON'T be on unfixed code
2. **Correct Arguments Test**: Verify `addToRecentlyPlayed` is called with the correct `profile_id`, `spotifyTrackId`, `title`, and `artist` — will fail on unfixed code
3. **Fuzzy Match Track Finish Test**: Simulate a track finishing where the queue match is by fuzzy name only — `addToRecentlyPlayed` should still be called but WON'T be on unfixed code
4. **No Queue Match Test**: Simulate a track finishing with no queue match at all — `addToRecentlyPlayed` should NOT be called (no `profile_id` available)

**Expected Counterexamples**:
- `addToRecentlyPlayed` is never invoked during `handleTrackFinishedImpl` on unfixed code
- The `recently_played_tracks` table remains empty after tracks finish playing

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := handleTrackFinishedImpl_fixed(input.state)
  ASSERT addToRecentlyPlayed was called with (
    profileId = matchedQueueItem.profile_id,
    entry.spotifyTrackId = currentTrack.id,
    entry.title = currentTrack.name,
    entry.artist = currentTrack.artists[0].name
  )
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT handleTrackFinishedImpl_original(input) = handleTrackFinishedImpl_fixed(input)
  // Specifically: markFinishedTrackAsPlayed called same way,
  // findNextValidTrack returns same result,
  // playNextTrackImpl called with same track,
  // DJService.maybeAnnounce called same way
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain (random track IDs, names, queue configurations)
- It catches edge cases that manual unit tests might miss (empty artists array, null track, duplicate detector rejections)
- It provides strong guarantees that track-transition behavior is unchanged for all inputs

**Test Plan**: Observe behavior on UNFIXED code first for track transitions (queue removal, next track selection, playback start), then write property-based tests capturing that behavior.

**Test Cases**:
1. **Queue Removal Preservation**: Verify that `markFinishedTrackAsPlayed` is still called with the correct track ID and name — same behavior before and after fix
2. **Next Track Selection Preservation**: Verify that `findNextValidTrack` is called and its result drives playback — same behavior before and after fix
3. **Playback Start Preservation**: Verify that `playNextTrackImpl` is called for the next track — same behavior before and after fix
4. **addToRecentlyPlayed Failure Preservation**: Verify that when `addToRecentlyPlayed` throws, the track transition still completes normally — queue removal, next track, and playback all succeed
5. **Duplicate Detector Preservation**: Verify that when `duplicateDetector.shouldProcessTrack` returns false, the method returns early without calling `markFinishedTrackAsPlayed` or `addToRecentlyPlayed` — same behavior before and after fix

### Unit Tests

- Test that `addToRecentlyPlayed` is called with correct arguments when a track finishes with a matching queue item
- Test that `addToRecentlyPlayed` is called with correct arguments when queue match is by fuzzy name
- Test that `addToRecentlyPlayed` is NOT called when no queue item matches (no `profile_id`)
- Test that `addToRecentlyPlayed` failure does not prevent track transition
- Test that `addToRecentlyPlayed` is NOT called when duplicate detector rejects the track

### Property-Based Tests

- Generate random track IDs, names, and queue configurations with matching items; verify `addToRecentlyPlayed` is always called with the correct `profile_id` and track metadata
- Generate random queue states and SDK states; verify `markFinishedTrackAsPlayed` call pattern is identical before and after fix
- Generate random `addToRecentlyPlayed` failure scenarios; verify track transition always completes

### Integration Tests

- Test full `handleTrackFinished` → `markFinishedTrackAsPlayed` → `addToRecentlyPlayed` → `findNextValidTrack` → `playNextTrackImpl` flow
- Test that after multiple tracks finish, `getRecentlyPlayed` returns all of them
- Test that AI auto-fill excludes tracks that were recorded via the new `addToRecentlyPlayed` call
