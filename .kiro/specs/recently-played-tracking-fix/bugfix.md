# Bugfix Requirements Document

## Introduction

The `recently_played_tracks` table is never populated when tracks finish playing naturally. When a track ends, `QueueSynchronizer.handleTrackFinishedImpl()` calls `markFinishedTrackAsPlayed()` which only removes the track from the queue — it never calls `addToRecentlyPlayed()`. The only place `addToRecentlyPlayed()` is called is in the `/api/ai-suggestions` route, which records AI-suggested tracks after they are returned (not after they are played). As a result, `getRecentlyPlayed()` always returns an empty array, and the AI auto-fill feature has no exclusion data — causing it to re-suggest songs that were already played.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a track finishes playing naturally (detected by `handleTrackFinishedImpl`) THEN the system removes the track from the queue via `markFinishedTrackAsPlayed()` but does NOT record it in the `recently_played_tracks` table

1.2 WHEN the AI auto-fill requests suggestions via `/api/ai-suggestions` THEN the system retrieves an empty recently-played list (`0 tracks excluded: none`) because no tracks were ever recorded as played

1.3 WHEN the AI generates new suggestions with an empty recently-played list THEN the system may suggest songs that were already played in the current session, leading to repetitive playback

### Expected Behavior (Correct)

2.1 WHEN a track finishes playing naturally (detected by `handleTrackFinishedImpl`) THEN the system SHALL record the track in the `recently_played_tracks` table via `addToRecentlyPlayed()` in addition to removing it from the queue

2.2 WHEN the AI auto-fill requests suggestions via `/api/ai-suggestions` THEN the system SHALL retrieve a populated recently-played list reflecting all tracks that have actually finished playing

2.3 WHEN the AI generates new suggestions with a populated recently-played list THEN the system SHALL exclude previously played tracks from the suggestions, preventing repetitive playback

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a track finishes playing naturally THEN the system SHALL CONTINUE TO remove the track from the queue via `markFinishedTrackAsPlayed()` and advance to the next track

3.2 WHEN `addToRecentlyPlayed()` fails (e.g. Supabase error) THEN the system SHALL CONTINUE TO complete the track transition without crashing — the recently-played write is non-critical and must not block playback

3.3 WHEN AI-suggested tracks are returned from `/api/ai-suggestions` THEN the system SHALL CONTINUE TO record those tracks as recently played via the existing fire-and-forget call in the route handler

3.4 WHEN a track is skipped manually or force-played via `playNextTrack` THEN the system SHALL CONTINUE TO behave as it does today (no change to those code paths in this fix)
