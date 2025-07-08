# Feature: Track Suggestion Logging

This document outlines the user stories and acceptance criteria for the feature that logs song suggestions from users. This involves persisting track information to our database and tracking suggestion frequency.

## User Story 1: Cataloging Suggested Songs

**As a** system administrator,
**I want** to store the metadata of every unique song that is suggested,
**so that** I can build a catalog of all songs that have been part of the jukebox experience.

### Acceptance Criteria

1.  **Given** a user adds a song to the playlist,
    **When** the action is triggered,
    **Then** the system must check if the song's `spotify_track_id` already exists in the `tracks` table.

2.  **Given** the song does not exist in the `tracks` table,
    **When** the user adds the song,
    **Then** a new record must be inserted into the `tracks` table containing the song's metadata, including `spotify_track_id`, `name`, `artist`, `album`, `duration_ms`, and `popularity`.

3.  **Given** the song already exists in the `tracks` table,
    **When** the user adds the song,
    **Then** the system must not create a duplicate entry for that song.

## User Story 2: Tracking User Song Suggestions

**As a** system administrator,
**I want** to track how many times each user suggests a particular song,
**so that** I can understand user preferences and song popularity over time.

### Acceptance Criteria

1.  **Given** a user adds a song to the playlist,
    **When** the song is successfully processed,
    **Then** the system must have access to the user's `profile_id` and the song's internal `track_id` (from the `tracks` table).

2.  **Given** a user adds a song to the playlist,
    **When** the suggestion is logged,
    **Then** the system must perform an `upsert` operation on the `suggested_tracks` table:
    - If a record for the user's `profile_id` and the song's `track_id` does not exist, a new record is inserted with the `count` set to 1, and both `first_suggested_at` and `last_suggested_at` are set to the current timestamp.
    - If a record already exists, its `count` is incremented by 1, and the `last_suggested_at` timestamp is updated to the current time.