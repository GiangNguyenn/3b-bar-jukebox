# Bugfix Requirements Document

## Introduction

The same song repeatedly restarts approximately 20 seconds into playback, creating an infinite restart loop. The root cause is that `syncQueueWithPlayback()` in `QueueSynchronizer` calls `playNextTrack()` when the currently playing Spotify track ID doesn't match any queue item — even when the track is the one we just started playing. Each `playNextTrack()` call triggers `onTrackStarted()` in `DJService`, which fires repeatedly as evidenced by dozens of "[DJService] onTrackStarted" log entries for the same track "Dirrty (feat. Redman)" with different random rolls. The problem is amplified by `AutoPlayService`'s dynamic polling, which increases SDK event frequency as the track progresses, generating more state changes that each re-trigger the sync logic.

Additionally, the excessive `onTrackStarted` logging (one entry per restart attempt with roll/threshold details) creates log clutter that makes diagnosing issues harder. Better logging is needed to surface the restart loop condition clearly.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a track is playing and `syncQueueWithPlayback()` runs but the Spotify track ID does not match any queue item by exact ID (e.g., due to Spotify track relinking returning a different ID variant) AND the fuzzy name match also fails (e.g., track name includes extra metadata like "(feat. Redman)" that doesn't match exactly) THEN the system calls `playNextTrack()` which restarts the same track, triggering another `onTrackStarted()` call and creating an infinite restart loop

1.2 WHEN the track restarts via `playNextTrack()` THEN the system fires a new SDK state change event which re-enters `syncQueueWithPlayback()`, which again fails to match the track, calling `playNextTrack()` again — each cycle completing in roughly 20 seconds before the next state change triggers the loop again

1.3 WHEN `AutoPlayService`'s dynamic polling interval decreases as the track progresses (from 1000ms down to 100ms near track end) THEN the system generates more frequent SDK state change events, increasing the rate at which `syncQueueWithPlayback()` is called and accelerating the restart loop

1.4 WHEN `onTrackStarted()` is called repeatedly for the same track due to the restart loop THEN the system logs a "[DJService] onTrackStarted" entry with roll/threshold details for every single invocation, creating excessive log clutter that obscures the actual problem

1.5 WHEN `syncQueueWithPlayback()` decides to call `playNextTrack()` because no queue match is found THEN the system does not log why the match failed (which IDs were compared, what the fuzzy match result was), making it difficult to diagnose the root cause

### Expected Behavior (Correct)

2.1 WHEN a track is playing and `syncQueueWithPlayback()` runs but the Spotify track ID does not exactly match any queue item THEN the system SHALL perform a robust fuzzy match (case-insensitive, handling parenthetical suffixes and featuring artist variations) and if a fuzzy match is found, SHALL treat the track as matched and NOT call `playNextTrack()`

2.2 WHEN `syncQueueWithPlayback()` has already called `playNextTrack()` for a given track THEN the system SHALL NOT call `playNextTrack()` again for the same track, preventing the restart loop by tracking which track was last force-played

2.3 WHEN `AutoPlayService` polling triggers state change events THEN the system SHALL NOT cause additional `playNextTrack()` calls for a track that is already playing and was started by the system, regardless of polling frequency

2.4 WHEN `onTrackStarted()` is called for the same track that was already announced THEN the system SHALL log a single concise deduplication message instead of repeating the full roll/threshold log line for every invocation

2.5 WHEN `syncQueueWithPlayback()` fails to find a queue match and decides to call `playNextTrack()` THEN the system SHALL log diagnostic information including the Spotify track ID, the expected queue track ID, the track names compared, and the fuzzy match result, so the mismatch reason is clear

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a track finishes naturally and the next track in the queue starts playing THEN the system SHALL CONTINUE TO call `onTrackStarted()` for the new track and trigger DJ prefetch logic as before

3.2 WHEN a track is playing and its Spotify ID exactly matches a queue item THEN the system SHALL CONTINUE TO update `currentQueueTrack` and `setCurrentlyPlayingTrack` without calling `playNextTrack()`

3.3 WHEN the queue is empty and no tracks are playing THEN the system SHALL CONTINUE TO set `currentlyPlayingTrack` to null and not attempt to play any track

3.4 WHEN a track is successfully started via `playNextTrack()` for the first time THEN the system SHALL CONTINUE TO call `DJService.onTrackStarted()`, upsert the played track, and update the queue manager state

3.5 WHEN `AutoPlayService` detects a track has finished THEN the system SHALL CONTINUE TO handle track transitions, auto-fill queue checks, and polling interval adjustments as before

3.6 WHEN `syncQueueWithPlayback()` detects a legitimate mismatch (a completely different, unexpected track is playing) THEN the system SHALL CONTINUE TO enforce queue order by calling `playNextTrack()` with the expected track
