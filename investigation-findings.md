# Investigation Findings: Next Song Playback Failures

## Summary

This investigation identified **5 critical issues** and **3 potential issues** that could cause the next song to fail to start when the current song ends. These issues involve unhandled exceptions, dead-end code paths, and error handling gaps.

---

## Critical Issues

### Issue 1: Unhandled Promise Rejection in Recursive `playNextTrack` Call

**File**: `services/playerLifecycle.ts`  
**Location**: Line 377  
**Severity**: Critical  
**Type**: Unhandled Exception

**Problem**:
The recursive call to `playNextTrack` at line 377 is not wrapped in a try-catch block. If this recursive call throws an error, it propagates to `handlePlayerStateChanged` which only logs the error and does not attempt to play the next track.

**Code Reference**:

```370:383:services/playerLifecycle.ts
      // Try to play the next track recursively
      const nextTrack = queueManager.getNextTrack()
      if (nextTrack) {
        this.log(
          'INFO',
          `[playNextTrack] Attempting to play next track in queue: ${nextTrack.tracks.name} (${nextTrack.tracks.spotify_track_id})`
        )
        await this.playNextTrack(nextTrack)
      } else {
        this.log(
          'WARN',
          '[playNextTrack] No next track available in queue after failed playback attempt'
        )
      }
```

**Error Propagation Path**:

1. `playNextTrack` fails to play track (line 347 returns `false`)
2. Recursive call to `playNextTrack(nextTrack)` at line 377
3. If recursive call throws → propagates to `handleTrackFinished` (line 671)
4. `handleTrackFinished` called from `handlePlayerStateChanged` (line 801)
5. `handlePlayerStateChanged` catches error at line 814 but only logs it

**Impact**: If the recursive call fails (e.g., device transfer fails, API error), the error is logged but no further attempt is made to play the next track. Playback stops.

---

### Issue 2: Silent Failure in `autoPlayService.playNextTrack` Error Handler

**File**: `services/autoPlayService.ts`  
**Location**: Lines 1904-1915  
**Severity**: Critical  
**Type**: Dead-End Code Path

**Problem**:
When `playNextTrack` catches an error from the API call (line 1904), it only logs the error and resets predictive state. It does NOT attempt to:

- Remove the problematic track from queue
- Try the next track in queue
- Retry the current track
- Notify the caller of failure

**Code Reference**:

```1881:1915:services/autoPlayService.ts
    try {
      const trackUri = `spotify:track:${track.tracks.spotify_track_id}`

      logger(
        'INFO',
        `[playNextTrack] Attempting to play track URI: ${trackUri} on device: ${this.deviceId}, Mode: ${isPredictive ? 'predictive' : 'reactive'}`
      )

      await sendApiRequest({
        path: 'me/player/play',
        method: 'PUT',
        body: {
          device_id: this.deviceId,
          uris: [trackUri]
        }
      })

      logger(
        'INFO',
        `[playNextTrack] Successfully started playback of track: ${track.tracks.name} (${track.tracks.spotify_track_id}), Queue ID: ${track.id}`
      )

      this.onNextTrackStarted?.(track)
    } catch (error) {
      logger(
        'ERROR',
        `[playNextTrack] Failed to play next track. Track: ${track.tracks.name} (${track.tracks.spotify_track_id}), Queue ID: ${track.id}, Device: ${this.deviceId}, Mode: ${isPredictive ? 'predictive' : 'reactive'}`,
        undefined,
        error as Error
      )
      // Reset predictive state on error
      if (isPredictive) {
        this.resetPredictiveState()
      }
    }
```

**Call Sites**:

- Called from `startNextTrackPredictively` at line 518 (wrapped in try-catch, sets `predictiveFailed` flag)
- Called from `handleTrackFinished` at line 710 (wrapped in try-catch at line 743)

**Impact**: If the API call fails, the error is silently swallowed. The function returns `void`, so callers have no indication of failure. No attempt is made to play the next track in queue, causing playback to stop.

---

### Issue 3: Early Return on Device Transfer Failure Without Fallback

**File**: `services/autoPlayService.ts`  
**Location**: Lines 1835-1846  
**Severity**: Critical  
**Type**: Dead-End Code Path

**Problem**:
If device transfer fails after all retry attempts, the function returns early without attempting playback. While there is a fallback check (lines 1792-1830), if that also fails and `transferred` remains `false`, the function returns at line 1846 without any attempt to play the track.

**Code Reference**:

```1835:1846:services/autoPlayService.ts
    if (!transferred) {
      logger(
        'ERROR',
        `[playNextTrack] Failed to transfer playback to app device: ${this.deviceId} after all retry attempts. Cannot play next track. Track: ${track.tracks.name}, Queue ID: ${track.id}, Total transfer errors: ${transferErrors.length}`,
        undefined,
        transferErrors[transferErrors.length - 1]
      )
      // Reset predictive state on error
      if (isPredictive) {
        this.resetPredictiveState()
      }
      return
    }
```

**Impact**: If device transfer fails and the fallback check also fails, playback stops without attempting the next track. This is a dead-end path.

**Note**: The same issue exists in `playerLifecycle.ts` at lines 298-305, but that implementation has better error recovery (recursive call to try next track).

---

### Issue 4: Early Return on Duplicate Track Detection Without Attempting Next Track

**File**: `services/autoPlayService.ts`  
**Location**: Lines 1860-1869  
**Severity**: Critical  
**Type**: Dead-End Code Path

**Problem**:
If the defensive check detects the track is already playing, the function returns early without attempting to play the next track in queue. This could happen if:

- Queue state is out of sync
- Previous track failed to remove from queue
- Track was manually started

**Code Reference**:

```1851:1869:services/autoPlayService.ts
    try {
      const currentPlaybackState = await sendApiRequest<{
        item?: { id: string; name: string }
        is_playing: boolean
      }>({
        path: 'me/player',
        method: 'GET'
      })

      if (
        currentPlaybackState?.item &&
        currentPlaybackState.item.id === track.tracks.spotify_track_id &&
        currentPlaybackState.is_playing
      ) {
        logger(
          'WARN',
          `[playNextTrack] Track ${track.tracks.name} (${track.tracks.spotify_track_id}) is already playing. Skipping playback to prevent duplicate.`
        )
        return
      }
```

**Impact**: If this check triggers (indicating a queue sync issue), the function returns without attempting the next track. This could cause playback to stop if the queue has other tracks available.

**Note**: The same issue exists in `playerLifecycle.ts` at lines 320-329.

---

### Issue 5: Error in `handleTrackFinished` Fallback Not Retried

**File**: `services/autoPlayService.ts`  
**Location**: Lines 699-711  
**Severity**: Critical  
**Type**: Silent Failure

**Problem**:
The fallback `playNextTrack` call at line 710 is wrapped in a try-catch (line 743), but if it fails, the error is only logged. No retry or alternative mechanism is attempted.

**Code Reference**:

```695:711:services/autoPlayService.ts
      // After updating the queue, perform a safety check:
      // if playback has stopped but there is a next track available,
      // proactively start it. This complements PlayerLifecycle's
      // SDK-driven handling and ensures we don't stall after transitions.
      const safeNextTrack = this.queueManager.getNextTrack()
      const latestPlaybackState = await this.getCurrentPlaybackState()

      if (
        safeNextTrack &&
        (!latestPlaybackState || latestPlaybackState.is_playing === false)
      ) {
        logger(
          'WARN',
          '[handleTrackFinished] Playback is not active but queue has tracks – starting next track as fallback'
        )
        await this.playNextTrack(safeNextTrack, false)
      }
```

**Error Handling**:

```743:750:services/autoPlayService.ts
    } catch (error) {
      logger(
        'ERROR',
        'Error handling track finished',
        undefined,
        error as Error
      )
    }
```

**Impact**: If the fallback `playNextTrack` call fails, the error is caught and logged, but no further action is taken. Playback stops.

---

## Potential Issues

### Issue 6: Queue State Rollback Could Affect Next Track Retrieval

**File**: `services/queueManager.ts`  
**Location**: Lines 89-99, 112-122  
**Severity**: Medium  
**Type**: Race Condition

**Problem**:
If `markAsPlayed` fails after exhausting retries, it rolls back the optimistic update by adding the track back to the queue at the beginning (line 95, 119). However, if another operation (like `getNextTrack`) is called between the optimistic removal and the rollback, it could return an incorrect track.

**Code Reference**:

```89:99:services/queueManager.ts
        // Exhausted retries - rollback the optimistic update
        console.error(
          `Failed to mark track ${queueId} as played after ${maxRetries + 1} attempts, rolling back local queue`
        )

        // Add track back to queue at the beginning (it was highest priority)
        this.queue.unshift(trackToRemove)
        this.pendingDeletes.delete(queueId)

        const errorData = await response.json()
        throw new Error(`Failed to mark track as played: ${errorData.message}`)
```

**Impact**: While this is handled by throwing an error (which should be caught by callers), there's a window where the queue state is inconsistent. If `getNextTrack` is called during this window, it could return the wrong track.

---

### Issue 7: Recursive Call Error Not Caught in `playerLifecycle.playNextTrack`

**File**: `services/playerLifecycle.ts`  
**Location**: Line 377  
**Severity**: Medium  
**Type**: Unhandled Exception

**Problem**:
The recursive call at line 377 is not wrapped in try-catch. While errors would propagate to `handlePlayerStateChanged` (which has a try-catch), if the recursive call fails, no attempt is made to try the next track after that.

**Code Reference**:

```370:383:services/playerLifecycle.ts
      // Try to play the next track recursively
      const nextTrack = queueManager.getNextTrack()
      if (nextTrack) {
        this.log(
          'INFO',
          `[playNextTrack] Attempting to play next track in queue: ${nextTrack.tracks.name} (${nextTrack.tracks.spotify_track_id})`
        )
        await this.playNextTrack(nextTrack)
      } else {
        this.log(
          'WARN',
          '[playNextTrack] No next track available in queue after failed playback attempt'
        )
      }
```

**Impact**: If the recursive call throws, the error propagates up and is caught by `handlePlayerStateChanged`, but no further attempt is made to play tracks. This could stop playback even if there are more tracks in queue.

---

### Issue 8: No Device ID Early Return Without Notification

**File**: Both `services/playerLifecycle.ts` and `services/autoPlayService.ts`  
**Location**: Lines 200-207 (playerLifecycle), 1739-1744 (autoPlayService)  
**Severity**: Low  
**Type**: Dead-End Code Path

**Problem**:
If `deviceId` is null, both implementations return early. While this is correct behavior, the caller has no way to know the function failed. The function returns `void`, so there's no indication of failure.

**Code Reference**:

```199:208:services/playerLifecycle.ts
  private async playNextTrack(track: JukeboxQueueItem): Promise<void> {
    if (!this.deviceId) {
      this.log(
        'ERROR',
        'No device ID available to play next track',
        undefined,
        undefined
      )
      return
    }
```

**Impact**: If device ID is missing, playback stops without attempting the next track. While this is expected behavior, it's a silent failure from the caller's perspective.

---

## Error Propagation Map

### `playerLifecycle.playNextTrack` Call Chain:

1. `handlePlayerStateChanged` (line 801) → calls `handleTrackFinished`
2. `handleTrackFinished` (line 671) → calls `playNextTrack` (not wrapped in try-catch)
3. `playNextTrack` (line 377) → recursive call (not wrapped in try-catch)
4. Errors propagate to `handlePlayerStateChanged` (line 814) → only logged

### `autoPlayService.playNextTrack` Call Chain:

1. `startNextTrackPredictively` (line 518) → calls `playNextTrack` (wrapped in try-catch, sets `predictiveFailed`)
2. `handleTrackFinished` (line 710) → calls `playNextTrack` (wrapped in try-catch at line 743)
3. Errors caught but not acted upon (no retry, no next track attempt)

---

## Recommendations

1. **Wrap recursive `playNextTrack` call in try-catch** (Issue 1, 7)
2. **Add error recovery in `autoPlayService.playNextTrack`** (Issue 2) - attempt next track on failure
3. **Add fallback mechanism for device transfer failures** (Issue 3) - attempt playback anyway
4. **Handle duplicate track detection more gracefully** (Issue 4) - attempt next track instead of returning
5. **Add retry mechanism for fallback `playNextTrack` calls** (Issue 5)
6. **Consider making `playNextTrack` return success/failure status** (Issues 2, 8)

---

## Recursive Call Safety Analysis

### Recursion Depth Protection

**File**: `services/playerLifecycle.ts`  
**Location**: Line 377

**Analysis**:

- The recursive call removes the problematic track from queue before recursing (line 357)
- Each recursive call processes a different track (next in queue)
- Queue size decreases with each call, ensuring eventual termination
- No explicit recursion depth limit, but queue size naturally limits depth

**Risk Assessment**: **Low** - Recursion is bounded by queue size. However, if all tracks in queue fail to play, recursion depth equals queue length. For typical queue sizes (10-50 tracks), this is safe.

**Potential Issue**: If queue has many tracks that all fail, recursion depth could be high. Consider adding explicit depth limit or converting to iterative approach.

---

## Queue State Consistency Analysis

### Rollback Window Race Condition

**File**: `services/queueManager.ts`  
**Location**: Lines 51-53, 89-99, 112-122

**Analysis**:

1. `markAsPlayed` optimistically removes track from queue (line 53)
2. If API call fails, track is rolled back to queue (lines 95, 119)
3. Between removal and rollback, `getNextTrack()` could return incorrect track

**Timeline**:

- T0: Track removed from queue (optimistic update)
- T1: `getNextTrack()` called → returns next track (correct)
- T2: API call fails
- T3: Track rolled back to queue (line 95/119)

**Impact**:

- If `getNextTrack()` is called between T0 and T3, it returns the correct next track
- If API call succeeds, rollback never happens (safe)
- If API call fails, rollback happens, but `getNextTrack()` may have already been called with stale data

**Risk Assessment**: **Medium** - The `pendingDeletes` Set (line 56) prevents queue refresh from bringing back tracks during deletion, but doesn't prevent `getNextTrack()` from being called during the rollback window.

**Evidence from Code**:

```51:56:services/queueManager.ts
    // Optimistically remove from local queue immediately
    // This prevents race conditions with queue refreshes during the DELETE request
    this.queue = this.queue.filter((track) => track.id !== queueId)

    // Mark as pending delete to prevent queue refresh from bringing it back
    this.pendingDeletes.add(queueId)
```

The `pendingDeletes` Set protects against queue refresh race conditions, but not against `getNextTrack()` being called during the rollback window.

---

## Conclusion

The investigation identified **5 critical issues** that could cause the next song to fail to start:

1. Unhandled promise rejection in recursive call
2. Silent failure in error handler
3. Early return on device transfer failure
4. Early return on duplicate detection
5. Fallback error not retried

All of these issues involve error handling gaps where failures are logged but no recovery action is taken. The most critical issue is **Issue 2** (`autoPlayService.playNextTrack` silent failure), as it affects both predictive and reactive playback paths.

### Additional Findings:

- **Recursion Safety**: Recursive calls are bounded by queue size, but no explicit depth limit exists
- **Queue Consistency**: Rollback mechanism has a race condition window where `getNextTrack()` could return stale data
