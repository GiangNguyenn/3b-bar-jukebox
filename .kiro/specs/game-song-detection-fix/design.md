# Game Song Detection Fix — Bugfix Design

## Overview

When the game page is backgrounded (phone lock screen, tab switch), iOS Safari and other mobile browsers kill WebSocket connections, causing the Supabase Realtime subscription in `useNowPlayingRealtime` to drop silently. The 30-second fallback polling interval is too slow to catch song transitions that occur while backgrounded. When the user returns, the old trivia question lingers for up to 30 seconds.

The fix is minimal and surgical: the game page passes a shorter `fallbackInterval` (5s) to `useNowPlayingRealtime` (which already accepts this parameter), and the hook gains an accelerated polling burst after visibility restoration (poll every 2s for 10s, then settle back to the normal interval). No changes to `useTriviaGame` or the game page component are needed beyond passing the shorter interval — the game hook already reacts to `nowPlaying.item.id` changes.

## Glossary

- **Bug_Condition (C)**: A song transition occurs while the browser tab is not visible (backgrounded/lock screen), and the system fails to detect it promptly upon return
- **Property (P)**: Song changes are detected within a few seconds of visibility restoration via immediate re-fetch and accelerated polling burst
- **Preservation**: Foreground Realtime-based detection, trivia question fetching, localStorage answer persistence, and play/pause handling remain unchanged
- **useNowPlayingRealtime**: Hook in `hooks/useNowPlayingRealtime.ts` that manages Supabase Realtime subscription + fallback polling for the `now_playing` table
- **useTriviaGame**: Hook in `hooks/trivia/useTriviaGame.ts` that watches `nowPlaying.item.id` and fetches new trivia questions on song change
- **fallbackInterval**: Parameter accepted by `useNowPlayingRealtime` controlling the polling interval (currently defaults to 30s)
- **Visibility burst**: A temporary period of accelerated polling (every 2s for 10s) triggered when the tab regains focus

## Bug Details

### Bug Condition

The bug manifests when a song transition occurs while the browser tab is not visible (phone lock screen active, tab backgrounded, app switcher). The Supabase Realtime WebSocket is killed by the browser, the `visibilitychange` handler triggers a single re-fetch and resubscribe, but if the song changed moments before the user returns (or the re-fetch races with the DB update), the 30-second polling interval is too slow to catch it. The game page has no mechanism to request a faster polling cadence.

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT: input of type { tabWasBackgrounded: boolean, songChangedWhileBackgrounded: boolean, timeSinceVisibilityRestore: number }
  OUTPUT: boolean

  RETURN input.tabWasBackgrounded = true
         AND input.songChangedWhileBackgrounded = true
         AND input.timeSinceVisibilityRestore <= fallbackInterval
END FUNCTION
```

### Examples

- User is playing trivia, phone auto-locks during a song transition. User unlocks phone 15 seconds later. The Realtime channel was killed. The single `fetchFromTable()` on visibility restore races with the DB write and returns stale data. Next poll is 30s away. User sees old question for ~25 seconds.
- User switches to another app mid-song. Song changes 2 seconds later. User returns after 10 seconds. Realtime resubscribe takes a few seconds to establish. The 30s polling hasn't fired yet. User sees stale question.
- User backgrounds the tab, song changes, returns after 5 seconds. The immediate `fetchFromTable()` succeeds and picks up the new track — this case already works. The bug is the gap when the immediate fetch misses the change.
- Edge case: User backgrounds tab, no song change occurs, returns. No bug — the existing state is correct and no action is needed.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- When the tab is in the foreground and the Realtime subscription is active, song changes are detected via Realtime with no additional polling overhead (requirement 3.1)
- When a song change is detected (via Realtime, polling, or visibility recovery), `useTriviaGame` fetches a new trivia question, resets answer state, and displays the new question (requirement 3.2)
- When the user refreshes the page after answering, the previously saved answer is restored from localStorage (requirement 3.3)
- When the `now_playing` row updates with a play/pause change (same track ID), no new trivia question is fetched (requirement 3.4)

**Scope:**
All inputs where the tab remains in the foreground, or where no song change occurs during backgrounding, should be completely unaffected by this fix. This includes:
- Normal foreground Realtime-driven song detection
- Play/pause state changes
- Page refreshes and answer restoration
- Leaderboard updates and score submissions

## Hypothesized Root Cause

Based on the bug description and code analysis, the root causes are:

1. **Polling interval too slow for game context**: `useNowPlayingRealtime` defaults to 30s polling. The display page can tolerate this latency, but the game page cannot — stale questions break the gameplay experience. The hook already accepts `fallbackInterval` but the game page doesn't pass a shorter value.

2. **Single re-fetch on visibility restore is insufficient**: The `visibilitychange` handler calls `fetchFromTable()` once and resubscribes to Realtime. If the DB write hasn't landed yet (race condition) or the fetch fails transiently, there's no retry — the next poll is 30s away.

3. **No accelerated polling burst after visibility restore**: After the tab regains focus, the system should temporarily poll more aggressively to catch any song changes that the single re-fetch missed. The current implementation has no burst mechanism.

## Correctness Properties

Property 1: Bug Condition — Song Change Detected After Visibility Restore

_For any_ input where the tab was backgrounded and a song change occurred during that period, the fixed `useNowPlayingRealtime` hook SHALL detect the song change within 5 seconds of visibility restoration, via the combination of immediate re-fetch and accelerated polling burst (every 2s for 10s).

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation — Foreground Behavior Unchanged

_For any_ input where the tab remains in the foreground (no visibility change event), the fixed `useNowPlayingRealtime` hook SHALL produce exactly the same behavior as the original: Realtime subscription delivers updates, fallback polling fires at the configured interval, and no additional polling overhead is introduced.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `hooks/useNowPlayingRealtime.ts`

**Function**: `useNowPlayingRealtime` (the `handleVisibilityChange` callback and polling setup)

**Specific Changes**:

1. **Add accelerated polling burst on visibility restore**: When `visibilitychange` fires with `visible`, start a burst polling phase — poll every 2s for 10s, then revert to the normal `fallbackInterval`. Use a ref to track the burst timer and clean it up on unmount.

2. **Clear and restart the normal polling interval after burst**: When the burst ends, clear the burst interval and restart the normal `setInterval` with `fallbackInterval` to avoid overlapping timers.

3. **Log burst activation**: Use `console.warn` (consistent with existing subscription status logging in this hook) to log when burst polling starts and ends for debuggability.

---

**File**: `hooks/trivia/useTriviaGame.ts`

**Function**: `useTriviaGame` (the `useNowPlayingRealtime` call)

**Specific Changes**:

1. **Pass shorter fallbackInterval**: Change the `useNowPlayingRealtime` call to pass `fallbackInterval: 5000` instead of relying on the 30s default. This ensures the game page polls every 5s even outside of burst periods.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that simulate the visibility change lifecycle — background the tab, change the now_playing data, restore visibility — and measure how long it takes for the hook to reflect the new track. Run these tests on the UNFIXED code to observe the 30s detection gap.

**Test Cases**:
1. **Stale Detection After Background**: Simulate tab backgrounding → update now_playing row → restore visibility → assert hook still has old track ID after 5 seconds (will fail on unfixed code — 30s polling means stale data persists)
2. **No Burst Polling**: After visibility restore on unfixed code → verify no accelerated polling occurs → only the single fetchFromTable fires (will fail on unfixed code — no burst mechanism exists)
3. **Game Page Default Interval**: Verify useTriviaGame calls useNowPlayingRealtime with default 30s interval (will fail on unfixed code — game page doesn't pass a shorter interval)

**Expected Counterexamples**:
- After visibility restore, the hook returns stale track data for up to 30 seconds
- No burst polling mechanism exists — only a single fetch fires on visibility change
- The game page relies on the 30s default polling interval

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := useNowPlayingRealtime_fixed(input)
  ASSERT result.data.item.id = newTrackId
  ASSERT detectionDelay <= 5 seconds after visibility restored
  ASSERT burstPollingActivated = true
  ASSERT burstInterval = 2000ms
  ASSERT burstDuration = 10000ms
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT useNowPlayingRealtime_original(input) = useNowPlayingRealtime_fixed(input)
  ASSERT noBurstPollingActivated
  ASSERT normalPollingInterval = fallbackInterval
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain (various track IDs, playback states, timing scenarios)
- It catches edge cases that manual unit tests might miss (e.g., rapid consecutive visibility changes, same track ID across transitions)
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for foreground scenarios (Realtime updates, play/pause changes, page refreshes), then write property-based tests capturing that behavior.

**Test Cases**:
1. **Foreground Realtime Preservation**: Verify that when the tab stays in the foreground, Realtime updates are delivered and no burst polling is triggered — observe on unfixed code, then verify after fix
2. **Play/Pause Preservation**: Verify that play/pause state changes (same track ID) do not trigger new trivia question fetches — observe on unfixed code, then verify after fix
3. **Answer Persistence Preservation**: Verify that localStorage answer restoration works identically after the fix — observe on unfixed code, then verify after fix
4. **Polling Interval Preservation**: Verify that the normal fallback polling interval is maintained when no visibility change occurs — observe on unfixed code, then verify after fix

### Unit Tests

- Test that `useNowPlayingRealtime` starts burst polling (2s interval) after `visibilitychange` to `visible`
- Test that burst polling stops after 10s and reverts to normal `fallbackInterval`
- Test that `useTriviaGame` passes `fallbackInterval: 5000` to `useNowPlayingRealtime`
- Test that multiple rapid visibility changes don't create overlapping burst timers
- Test that burst timer is cleaned up on component unmount

### Property-Based Tests

- Generate random sequences of visibility change events with varying timing and verify: burst polling activates on each `visible` event, no overlapping timers, cleanup on unmount
- Generate random now_playing states (same track, different track, null) and verify: foreground behavior is identical to original — Realtime updates reflected, no spurious question fetches
- Generate random fallbackInterval values and verify: normal polling uses the configured interval, burst always uses 2s regardless of fallbackInterval

### Integration Tests

- Test full game flow: background tab → song changes → restore visibility → verify new trivia question appears within 5s
- Test burst-to-normal transition: trigger visibility restore → verify 2s polling for 10s → verify revert to 5s polling
- Test no-change scenario: background tab → no song change → restore visibility → verify same question remains displayed
