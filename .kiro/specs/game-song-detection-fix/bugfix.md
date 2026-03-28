# Bugfix Requirements Document

## Introduction

The game page fails to reliably detect song changes when the user's phone lock screen is active or the browser tab is backgrounded. On iOS Safari (and other mobile browsers), WebSocket connections are killed when the tab loses focus, causing the Supabase Realtime subscription to drop silently. The fallback polling interval of 30 seconds is too slow to catch song transitions promptly. When the user returns to the app, there is a gap where the old question is still displayed because the visibility change handler only triggers a re-fetch in `useNowPlayingRealtime` but the game page has no additional mechanism to aggressively detect the stale state.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the phone lock screen activates or the browser tab is backgrounded during a song transition THEN the system fails to detect the song change because the Supabase Realtime WebSocket is killed by the browser and the 30-second fallback polling interval is too slow to catch the transition

1.2 WHEN the user returns to the game page after the lock screen was active (visibility changes to visible) THEN the system may still display the previous song's trivia question for up to 30 seconds because the fallback polling has not yet fired and the Realtime channel has not yet reconnected and delivered the update

1.3 WHEN the Supabase Realtime subscription drops silently while the tab is backgrounded THEN the system has no mechanism to detect the dropped connection and compensate with more aggressive polling

### Expected Behavior (Correct)

2.1 WHEN the phone lock screen activates or the browser tab is backgrounded during a song transition THEN the system SHALL detect the song change within a few seconds of the user returning to the app by using a shorter polling interval and immediate re-fetch on visibility restoration

2.2 WHEN the user returns to the game page after the lock screen was active (visibility changes to visible) THEN the system SHALL immediately fetch the current now-playing state and update the trivia question if the song has changed, with no perceptible delay

2.3 WHEN the Supabase Realtime subscription drops silently while the tab is backgrounded THEN the system SHALL use an accelerated polling interval (e.g., 5 seconds) as a more responsive fallback to ensure song changes are detected promptly even without a live WebSocket connection

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the browser tab is in the foreground and the Realtime subscription is active THEN the system SHALL CONTINUE TO detect song changes via the Supabase Realtime subscription with no additional polling overhead

3.2 WHEN a song change is detected (whether via Realtime, polling, or visibility recovery) THEN the system SHALL CONTINUE TO fetch a new trivia question, reset the answer state, and display the new question correctly

3.3 WHEN the user has already answered a trivia question and the page is refreshed THEN the system SHALL CONTINUE TO restore the previously saved answer from localStorage to prevent re-answering

3.4 WHEN the now_playing row is updated with a play/pause state change (same track) THEN the system SHALL CONTINUE TO update the playback state without triggering a new trivia question fetch

---

## Bug Condition

### Bug Condition Function

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type GameVisibilityState
  OUTPUT: boolean

  // The bug triggers when a song transition occurs while the tab is not visible
  // (lock screen active, tab backgrounded, etc.) and the user returns to the app
  RETURN X.tabWasBackgrounded = true
     AND X.songChangedWhileBackgrounded = true
END FUNCTION
```

### Property Specification — Fix Checking

```pascal
// Property: Fix Checking — Song change detection after backgrounding
FOR ALL X WHERE isBugCondition(X) DO
  result ← detectSongChange'(X)
  ASSERT result.songChangeDetected = true
     AND result.detectionDelay <= 5 seconds after visibility restored
     AND result.newQuestionDisplayed = true
END FOR
```

### Preservation Goal

```pascal
// Property: Preservation Checking — Foreground behavior unchanged
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT detectSongChange(X) = detectSongChange'(X)
END FOR
```
