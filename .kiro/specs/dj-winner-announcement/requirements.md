# Requirements Document

## Introduction

When the trivia game countdown reaches zero and the game resets, the DJ should verbally announce the winner of that round. The announcement must use the existing Venice AI TTS pipeline and integrate with the current DJ mode audio system. The announcement requires volume ducking (lowering music volume during speech, then restoring it), and must be queued behind any in-progress DJ speech (e.g., song introductions) rather than being dropped or overlapping. This feature is triggered from the admin page, which is the only page guaranteed to have an active audio context.

## Glossary

- **DJ_Service**: The client-side singleton (`DJService`) that manages DJ audio playback, volume ducking, TTS fetching, and announcement sequencing
- **Winner_Announcement**: A TTS audio clip announcing the trivia round winner's name and score, played through the DJ_Service
- **Volume_Ducker**: The subsystem within DJ_Service responsible for lowering Spotify music volume before a DJ speech and restoring it afterward
- **Announcement_Queue**: A sequential queue within DJ_Service that holds pending announcements so they play one after another without overlap or loss
- **Trivia_Reset_Timer**: The admin-page hook (`useTriviaResetTimer`) that fires the reset API call when the countdown hits zero
- **Winner_Announcement_Hook**: The admin-page hook (`useTriviaWinnerAnnouncement`) that listens for winner announcement rows via Supabase Realtime and triggers DJ_Service playback
- **TTS_API**: The server-side API route (`/api/dj-tts`) that converts text to speech audio via Venice AI
- **Spotify_Volume_API**: The Spotify Web API volume endpoint used by `SpotifyApiService.setVolume()` to control music volume
- **Realtime_Fallback_Poller**: A polling mechanism within the Winner_Announcement_Hook that queries `dj_announcements` for unprocessed rows when Supabase Realtime is detected as unreliable, serving as a backup delivery path
- **Realtime_Health_Monitor**: Logic within the Winner_Announcement_Hook that tracks whether the Supabase Realtime subscription is connected and delivering events, used to decide when to activate the Realtime_Fallback_Poller

## Requirements

### Requirement 1: Volume Ducking During Winner Announcement

**User Story:** As a venue owner, I want the music volume to be lowered when the DJ announces the trivia winner, so that patrons can clearly hear the announcement over the music.

#### Acceptance Criteria

1. WHEN a Winner_Announcement begins playback, THE DJ_Service SHALL read the current Spotify music volume via Spotify_Volume_API before lowering it
2. WHEN a Winner_Announcement begins playback, THE Volume_Ducker SHALL reduce the Spotify music volume to 20% of the original volume
3. WHEN the Winner_Announcement audio finishes playing, THE Volume_Ducker SHALL ramp the Spotify music volume back to the original volume over a 2-second duration
4. IF the Spotify_Volume_API fails to read the current volume, THEN THE Volume_Ducker SHALL assume an original volume of 100% and proceed with ducking
5. IF the Spotify_Volume_API fails to set the ducked volume, THEN THE DJ_Service SHALL still play the Winner_Announcement audio without ducking

### Requirement 2: Announcement Queuing Behind Active DJ Speech

**User Story:** As a venue owner, I want the winner announcement to wait if the DJ is currently speaking (e.g., introducing a song), so that announcements do not overlap or get dropped.

#### Acceptance Criteria

1. WHILE the DJ_Service has an announcement in progress, THE DJ_Service SHALL enqueue the Winner_Announcement in the Announcement_Queue instead of discarding it
2. WHEN the in-progress announcement finishes, THE DJ_Service SHALL dequeue and play the next pending announcement from the Announcement_Queue
3. THE Announcement_Queue SHALL process announcements in first-in-first-out order
4. THE DJ_Service SHALL process queued announcements sequentially, playing one announcement at a time
5. IF the DJ_Service has no announcement in progress, THEN THE DJ_Service SHALL play the Winner_Announcement immediately without queuing

### Requirement 3: Winner Announcement TTS Generation

**User Story:** As a venue owner, I want the winner announcement to use the same DJ voice as other announcements, so that the experience feels consistent.

#### Acceptance Criteria

1. WHEN a trivia winner is determined, THE DJ_Service SHALL generate the Winner_Announcement audio by calling the TTS_API with the announcement text
2. THE DJ_Service SHALL use the venue owner's configured DJ voice setting for the Winner_Announcement TTS request
3. IF the TTS_API fails to generate audio, THEN THE DJ_Service SHALL log the error and skip the Winner_Announcement without affecting other DJ operations
4. THE Winner_Announcement text SHALL include the winning player's name and score

### Requirement 4: Admin Page Trigger on Countdown Zero

**User Story:** As a venue owner, I want the winner announcement to be triggered automatically when the trivia countdown reaches zero, so that I do not need to manually initiate it.

#### Acceptance Criteria

1. WHEN the Trivia_Reset_Timer countdown reaches zero, THE Trivia_Reset_Timer SHALL call the trivia reset API which determines the winner and inserts an announcement row into the database
2. WHEN the Winner_Announcement_Hook receives a new active announcement row via Supabase Realtime, THE Winner_Announcement_Hook SHALL pass the announcement text to the DJ_Service for playback
3. WHEN DJ mode is disabled, THE DJ_Service SHALL skip the Winner_Announcement without error
4. WHEN no players scored during the trivia round, THE Trivia_Reset_Timer SHALL skip the winner announcement entirely

### Requirement 5: Volume Restoration on Error

**User Story:** As a venue owner, I want the music volume to be restored even if the announcement fails mid-playback, so that the music does not stay quiet indefinitely.

#### Acceptance Criteria

1. IF the Winner_Announcement audio fails during playback, THEN THE Volume_Ducker SHALL restore the Spotify music volume to the original level
2. IF the Winner_Announcement audio element fires an error event, THEN THE DJ_Service SHALL restore volume and mark the announcement as complete so the queue can proceed
3. IF the TTS audio `play()` call is rejected by the browser, THEN THE DJ_Service SHALL restore volume immediately via a direct Spotify_Volume_API call

### Requirement 6: Realtime Fallback Polling for Winner Announcements

**User Story:** As a venue owner, I want the winner announcement to still be delivered even if the Supabase Realtime subscription is unreliable, so that trivia winners are always announced.

#### Acceptance Criteria

1. WHEN the Supabase Realtime subscription status is not "SUBSCRIBED" or no Realtime event has been received within a configurable timeout after the channel subscribes, THEN the Realtime_Health_Monitor SHALL mark the Realtime connection as unhealthy
2. WHEN the Realtime connection is marked unhealthy, THEN the Realtime_Fallback_Poller SHALL begin polling the `dj_announcements` table for unprocessed active rows at a regular interval (default 10 seconds)
3. WHEN the Realtime connection becomes healthy again, THEN the Realtime_Fallback_Poller SHALL stop polling and defer to the Realtime subscription for event delivery
4. WHEN the Realtime_Fallback_Poller finds an active unprocessed announcement row, THEN the Winner_Announcement_Hook SHALL pass the announcement text to the DJ_Service for playback, identical to the Realtime path
5. WHEN an announcement is delivered (via either Realtime or polling), THEN the Winner_Announcement_Hook SHALL mark the announcement row as processed (set `is_active` to false) to prevent duplicate playback
6. IF both Realtime and the Realtime_Fallback_Poller detect the same announcement row, THEN the Winner_Announcement_Hook SHALL ensure the announcement is played at most once by checking the processed state before triggering playback
7. WHEN the Winner_Announcement_Hook unmounts, THEN the Realtime_Fallback_Poller SHALL stop polling and clean up its interval timer
