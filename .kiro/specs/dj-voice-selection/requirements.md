# Requirements Document

## Introduction

DJ Voice Selection allows the admin to choose which TTS voice is used for English DJ announcements. The existing DJ Mode feature uses a hardcoded voice (`af_nova`) for the `tts-kokoro` model when generating English speech. This feature exposes the available `tts-kokoro` voices as a selectable option on the admin dashboard, persists the choice to `localStorage`, and passes it through to the `/api/dj-tts` route. Vietnamese voice selection is out of scope — this feature applies only to English TTS.

## Glossary

- **Admin_Page**: The admin control panel at `app/[username]/admin/` where the operator manages the jukebox.
- **DJ_Voice_Selector**: A UI component on the Admin_Page that displays available English TTS voices and allows the admin to pick one.
- **DJService**: The singleton service (`DJService`) that manages DJ announcement logic, prefetching, and audio playback.
- **TTS_Route**: The server-side API route at `/api/dj-tts` that proxies requests to Venice_TTS.
- **Venice_TTS**: Venice AI's text-to-speech endpoint (`https://api.venice.ai/api/v1/audio/speech`) using model `tts-kokoro` for English.
- **DJ_Voice**: The selected English TTS voice identifier (e.g. `af_nova`, `af_heart`, `af_bella`) sent to Venice_TTS. Stored in `localStorage` under the key `"djVoice"`.
- **Default_Voice**: The voice `af_nova`, used when no DJ_Voice preference has been set.

---

## Requirements

### Requirement 1: English Voice Selection UI on Admin Dashboard

**User Story:** As an admin, I want to pick which English TTS voice the DJ uses, so that I can choose a voice that fits the vibe of my venue.

#### Acceptance Criteria

1. THE Admin_Page SHALL display the DJ_Voice_Selector component in the dashboard tab settings area, visible when DJ Mode is enabled and DJ Language is set to English.
2. THE DJ_Voice_Selector SHALL present a list of available `tts-kokoro` voices as selectable options, each identified by a human-readable label and its voice identifier.
3. WHEN the admin selects a voice from the DJ_Voice_Selector, THE Admin_Page SHALL persist the selected voice identifier to `localStorage` under the key `"djVoice"`.
4. THE Admin_Page SHALL read the persisted `"djVoice"` value from `localStorage` on load and display the matching voice as selected in the DJ_Voice_Selector.
5. IF no `"djVoice"` value is present in `localStorage`, THEN THE DJ_Voice_Selector SHALL default to the Default_Voice (`af_nova`).
6. WHEN DJ Mode is disabled, THE Admin_Page SHALL hide the DJ_Voice_Selector.
7. WHEN DJ Language is set to Vietnamese, THE Admin_Page SHALL hide the DJ_Voice_Selector, since voice selection applies only to English TTS.

---

### Requirement 2: Voice Preference Passed to TTS Route

**User Story:** As an admin, I want my voice selection to be used when generating DJ audio, so that the announcements use the voice I chose.

#### Acceptance Criteria

1. WHEN the DJService fetches TTS audio for an English DJ announcement, THE DJService SHALL include the selected DJ_Voice identifier in the request body sent to the TTS_Route.
2. IF no DJ_Voice preference is stored in `localStorage`, THEN THE DJService SHALL send the Default_Voice (`af_nova`) in the request body.
3. WHEN the TTS_Route receives a request with a `voice` field and the language is English, THE TTS_Route SHALL forward that voice value to Venice_TTS in the `voice` parameter of the API call.
4. IF the TTS_Route receives a request without a `voice` field and the language is English, THEN THE TTS_Route SHALL use the Default_Voice (`af_nova`).
5. WHEN the language is Vietnamese, THE TTS_Route SHALL ignore any `voice` field and use the Vietnamese voice (`Vivian`) with the Vietnamese TTS model (`tts-qwen3-0-6b`).

---

### Requirement 3: Prefetch Invalidation on Voice Change

**User Story:** As an admin, I want the DJ to use my new voice choice immediately, so that I do not hear the old voice on the next announcement after switching.

#### Acceptance Criteria

1. WHEN the admin changes the selected voice in the DJ_Voice_Selector, THE DJService SHALL invalidate any in-progress or completed prefetched TTS audio so that the next announcement uses the newly selected voice.
2. WHEN the admin changes the selected voice, THE DJ_Voice_Selector SHALL dispatch a custom event so that other components can react to the change.

---

### Requirement 4: Available Voice List

**User Story:** As a developer, I want the list of available English voices to be defined in a single place, so that adding or removing voices requires only one change.

#### Acceptance Criteria

1. THE application SHALL define the list of available English `tts-kokoro` voices as a single constant array, each entry containing a voice identifier and a display label.
2. THE DJ_Voice_Selector SHALL render its options from this constant array.
3. THE TTS_Route SHALL validate incoming English voice values against this constant array.
4. IF the TTS_Route receives an English voice value that is not in the allowed list, THEN THE TTS_Route SHALL fall back to the Default_Voice (`af_nova`) and process the request normally.

---

### Requirement 5: Graceful Degradation

**User Story:** As an admin, I want DJ announcements to keep working even if something goes wrong with voice selection, so that the DJ feature remains reliable.

#### Acceptance Criteria

1. IF the `"djVoice"` value in `localStorage` is corrupted or not in the allowed voice list, THEN THE DJService SHALL fall back to the Default_Voice (`af_nova`).
2. IF the Venice_TTS endpoint rejects the selected voice, THEN THE TTS_Route SHALL return an error and THE DJService SHALL skip the announcement and play the next track without delay, consistent with existing error handling behavior.
