# Bugfix Requirements Document

## Introduction

During every track transition, the play button, skip button, and song progress bar become disabled and unclickable for the duration of the track handoff operation. The window is brief (milliseconds) for normal transitions but becomes several seconds long when DJ Mode is active and an announcement plays. The root cause is structural: `handleTrackFinishedImpl` runs inside a serialized `playbackService` operation that holds the queue locked for the entire transition — including `findNextValidTrack`, `maybeAnnounce` (DJ audio), and `playNextTrackImpl`. While that operation is in progress, `syncQueueWithPlayback` detects `isOperationInProgress()` and returns early without updating state, and `transformStateForUI` receives the finished-track SDK state (paused at position 0) which produces `null`, so `onPlaybackStateChange` is never called. The Zustand store's `playbackState` therefore stays stale (reflecting the ended track with `is_playing: false`), causing `isActuallyPlaying` to return `false` and the skip button's `disabled={!isReady || !isActuallyPlaying || isSkipLoading}` condition to lock out the control. The progress bar and track info also disappear because `currentlyPlaying?.item` is absent until the next polling cycle (every 20 seconds). This bug is present on every track transition regardless of DJ Mode, but DJ Mode amplifies the disabled window from near-zero to several seconds.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a track finishes and `handleTrackFinishedImpl` begins executing inside the serialized `playbackService` operation queue THEN the system holds `playbackService.isOperationInProgress()` as `true` for the entire duration of the transition (including next-track lookup, optional DJ announcement, and Spotify API playback call)

1.2 WHEN `playbackService.isOperationInProgress()` is `true` and a new Spotify SDK state event arrives THEN the system's `syncQueueWithPlayback` returns early without updating queue or playback state, discarding the state update

1.3 WHEN the Spotify SDK emits the track-finished state (paused=true, position=0) and `transformStateForUI` processes it THEN the system returns `null` (no current track in a valid playing state), so `onPlaybackStateChange` is not called and the Zustand `playbackState` is not updated

1.4 WHEN `playbackState` in the Zustand store is stale (reflecting the ended track with `is_playing: false`) during the transition window THEN the system computes `isActuallyPlaying` as `false`, causing the skip button to render as `disabled={!isReady || !isActuallyPlaying || isSkipLoading}` — disabled and unclickable

1.5 WHEN `playbackState` is stale or null during the transition window THEN the system renders the progress bar and track info conditionally on `currentlyPlaying?.item`, which is absent until the next 20-second polling cycle, causing the progress bar to disappear

1.6 WHEN DJ Mode is enabled and a DJ announcement is triggered THEN the system awaits `maybeAnnounce` (TTS audio playback, potentially several seconds) inside the same serialized `playbackService` operation, extending the disabled window from near-zero milliseconds to the full announcement duration

### Expected Behavior (Correct)

2.1 WHEN a track transition is in progress (between the end of one track and the confirmed start of the next) THEN the system SHALL keep the play button, skip button, and progress bar in an enabled and interactive state

2.2 WHEN the Spotify SDK emits state events during a track transition THEN the system SHALL propagate those state updates to the Zustand store so that `playbackState` and `isActuallyPlaying` reflect the most recent known state rather than a stale ended-track state

2.3 WHEN `isActuallyPlaying` cannot be determined from a live SDK state during a transition THEN the system SHALL default to keeping controls enabled rather than disabling them, so the user is never locked out

2.4 WHEN a DJ announcement is playing between tracks THEN the system SHALL NOT hold the `playbackService` serialized operation open for the duration of the TTS audio, so that state updates and other playback operations can proceed normally

2.5 WHEN the user clicks skip during a track transition or DJ announcement THEN the system SHALL be able to process the skip request without being blocked by the in-progress transition operation

2.6 WHEN a DJ announcement is playing THEN the system SHALL display a visual indicator (e.g. a "DJ is speaking..." status) so the user understands why no track is actively playing in Spotify

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a track finishes and the next track starts normally (no DJ announcement) THEN the system SHALL CONTINUE TO play the next track automatically without requiring user interaction

3.2 WHEN a track is actively playing with no transition in progress THEN the system SHALL CONTINUE TO display the play/pause button, skip button, and progress bar in their normal enabled states driven by `isActuallyPlaying`

3.3 WHEN a DJ announcement completes normally THEN the system SHALL CONTINUE TO start the next track at the correct volume (full volume without Duck & Overlay, or ramped volume with Duck & Overlay)

3.4 WHEN a DJ announcement fetch fails for any reason THEN the system SHALL CONTINUE TO play the next track immediately without blocking the UI

3.5 WHEN Duck & Overlay Mode is enabled THEN the system SHALL CONTINUE TO start the next track at 50% volume while the DJ audio plays and ramp back to 100% after the announcement ends

3.6 WHEN the serialized `playbackService` operation queue is used for track transitions THEN the system SHALL CONTINUE TO prevent race conditions between concurrent track-finished events
