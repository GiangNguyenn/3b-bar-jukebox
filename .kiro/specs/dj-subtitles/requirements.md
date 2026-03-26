# Requirements Document

## Introduction

When the AI DJ announces the next track, the generated script text is only available on the admin browser where the DJService runs. The public display page (`/{username}/display`) has no way to receive this text. This feature bridges that gap by persisting DJ announcement text to Supabase and subscribing to it on the display page, so subtitles appear in sync with the DJ audio and fade out when the announcement ends.

## Glossary

- **DJ_Announcement**: A record containing the DJ script text, the associated profile, and timing metadata (created timestamp, active/cleared status). Stored in a Supabase table.
- **DJService**: The existing singleton service (`services/djService.ts`) running on the admin browser that generates DJ scripts via Venice AI and plays TTS audio.
- **Display_Page**: The public now-playing page (`app/[username]/display/page.tsx`) that shows album art, track metadata, and visualizations on a separate device/tab.
- **Subtitle_Overlay**: A UI component rendered on the Display_Page that shows the DJ announcement text as large, readable subtitles over the existing display content.
- **Supabase_Realtime**: The Supabase realtime subscription mechanism (postgres_changes) already used in the codebase for queue updates.
- **Profile_ID**: The unique identifier for a venue owner's profile, used to scope DJ announcements to the correct venue.
- **Announcement_API**: A server-side API route (`/api/dj-announcement`) that accepts DJ script text and persists it to the `dj_announcements` Supabase table.
- **Clear_Signal**: An update to the DJ_Announcement record that sets it as inactive, signaling the Display_Page to hide the subtitles.

## Requirements

### Requirement 1: Persist DJ Announcement Text

**User Story:** As a venue owner, I want the DJ script text to be saved to the database when the DJ speaks, so that other clients (the display page) can access it.

#### Acceptance Criteria

1. WHEN the DJService successfully generates a DJ script and begins audio playback, THE DJService SHALL send the script text to the Announcement_API.
2. WHEN the Announcement_API receives a valid script text and Profile_ID, THE Announcement_API SHALL upsert a DJ_Announcement record in Supabase with the script text, Profile_ID, and an active status.
3. IF the Announcement_API receives a request with missing or invalid script text, THEN THE Announcement_API SHALL return a 400 error response with a descriptive message.
4. IF the Announcement_API fails to write to Supabase, THEN THE Announcement_API SHALL return a 500 error response without blocking DJ audio playback on the admin client.

### Requirement 2: Clear DJ Announcement After Playback

**User Story:** As a venue owner, I want the subtitles to disappear after the DJ finishes speaking, so that the display returns to its normal state.

#### Acceptance Criteria

1. WHEN the DJ audio playback ends on the admin client, THE DJService SHALL send a clear request to the Announcement_API that marks the DJ_Announcement as inactive.
2. WHEN the DJ audio playback encounters an error, THE DJService SHALL send a clear request to the Announcement_API so stale subtitles do not persist on the display.
3. THE Announcement_API SHALL accept a clear action that updates the existing DJ_Announcement record to inactive status for the given Profile_ID.

### Requirement 3: Display Subtitles via Realtime Subscription

**User Story:** As a patron viewing the display page, I want to see what the DJ is saying as readable subtitles, so that I can follow along even in a noisy environment.

#### Acceptance Criteria

1. WHEN the Display_Page loads, THE Display_Page SHALL subscribe to Supabase_Realtime changes on the `dj_announcements` table filtered by the venue's Profile_ID.
2. WHEN a new or updated DJ_Announcement with active status is received via Supabase_Realtime, THE Display_Page SHALL render the Subtitle_Overlay with the announcement text.
3. WHEN a DJ_Announcement update with inactive status is received via Supabase_Realtime, THE Display_Page SHALL hide the Subtitle_Overlay.
4. THE Subtitle_Overlay SHALL appear with a fade-in animation and disappear with a fade-out animation using Framer Motion.
5. THE Subtitle_Overlay SHALL be positioned at the bottom-center of the display viewport, above any existing QR code, with sufficient contrast against the dynamic color background.

### Requirement 4: Subtitle Readability

**User Story:** As a patron, I want the subtitles to be easily readable from a distance, so that I can read them on a TV or large screen across the room.

#### Acceptance Criteria

1. THE Subtitle_Overlay SHALL render text at a large font size (minimum 2rem) with a semi-transparent dark background panel for contrast.
2. THE Subtitle_Overlay SHALL use white or light-colored text with a text shadow to ensure readability against any dynamic background color.
3. THE Subtitle_Overlay SHALL constrain text width to prevent overflow and allow line wrapping for longer announcements.

### Requirement 5: Automatic Subtitle Timeout

**User Story:** As a venue owner, I want subtitles to automatically disappear after a reasonable time even if the clear signal is lost, so that stale text does not remain on screen indefinitely.

#### Acceptance Criteria

1. WHEN the Subtitle_Overlay becomes visible, THE Display_Page SHALL start a timeout of 30 seconds.
2. IF no clear signal is received within 30 seconds of the subtitle appearing, THEN THE Display_Page SHALL hide the Subtitle_Overlay automatically.
3. WHEN a new active DJ_Announcement is received, THE Display_Page SHALL reset the 30-second timeout.

### Requirement 6: Database Schema for DJ Announcements

**User Story:** As a developer, I want a dedicated table for DJ announcements with realtime enabled, so that the display page can subscribe to changes efficiently.

#### Acceptance Criteria

1. THE database SHALL contain a `dj_announcements` table with columns for `id` (UUID primary key), `profile_id` (foreign key to profiles), `script_text` (text), `is_active` (boolean), `created_at` (timestamp), and `updated_at` (timestamp).
2. THE `dj_announcements` table SHALL have Row Level Security enabled with a policy allowing public read access and authenticated write access.
3. THE `dj_announcements` table SHALL be added to the Supabase realtime publication so that postgres_changes events are emitted on inserts and updates.
4. THE `dj_announcements` table SHALL have a unique constraint on `profile_id` so that each venue has at most one announcement record that gets upserted.
