# Requirements Document

## Introduction

Replace the existing database-driven track suggestion system with an AI-powered song suggestion system. The new system uses Venice AI (already integrated in the project for DJ scripts and TTS) to suggest songs based on user-configurable prompts. Instead of querying a local `tracks` table with genre/year/popularity filters, the AI receives a prompt describing the desired music vibe and returns batches of 10 song suggestions at a time. The system provides 11 preset prompts for quick selection (including Vietnamese-specific options) and allows full prompt customization. Recently played songs (last 100) are excluded from suggestions to avoid repetition.

## Glossary

- **AI_Suggestion_Service**: The standalone server-side service module that communicates with Venice AI to generate song suggestions based on a prompt and resolves them to Spotify track IDs
- **Prompt**: A natural language description of the desired music style, mood, or theme that guides the AI in selecting songs
- **Preset_Prompt**: One of 11 predefined prompts that users can select for common music vibes
- **Custom_Prompt**: A user-written prompt that overrides or replaces a preset prompt
- **Suggestion_Batch**: A group of 10 songs returned by a single AI suggestion request
- **Recently_Played_List**: The list of the 100 most recently played song IDs used to prevent repeat suggestions
- **AutoPlay_Service**: The client-side service that monitors queue size and triggers suggestion requests when the queue drops below the target size
- **Admin_Dashboard**: The venue owner's control panel where suggestion settings are configured
- **Track_Suggestions_Tab**: The UI tab within the Admin Dashboard for configuring song suggestion behavior
- **Queue**: The ordered list of songs waiting to be played by the jukebox
- **Old_Suggestion_System**: The deprecated database-driven track suggestion system including findSuggestedTrack, the `/api/track-suggestions` endpoint, genre/year/popularity UI selectors, TrackSuggestionsState type, suggestionsCooldown utility, and related constants

## Requirements

### Requirement 1: AI-Powered Song Suggestion via Prompt

**User Story:** As a venue owner, I want the system to use AI to suggest songs based on a descriptive prompt, so that the song queue is populated with contextually relevant music instead of random database matches.

#### Acceptance Criteria

1. WHEN a suggestion request is triggered, THE AI_Suggestion_Service SHALL send the active prompt to Venice AI and return a Suggestion_Batch of 10 song recommendations
2. THE AI_Suggestion_Service SHALL include song title and artist name for each recommendation in the Suggestion_Batch
3. WHEN Venice AI returns song recommendations, THE AI_Suggestion_Service SHALL resolve each recommendation to a valid Spotify track ID using the Spotify Search API
4. IF Venice AI fails to respond within 25 seconds, THEN THE AI_Suggestion_Service SHALL return an error and log the timeout using createModuleLogger
5. IF Venice AI returns fewer than 10 valid recommendations, THEN THE AI_Suggestion_Service SHALL proceed with the available recommendations rather than retrying

### Requirement 2: Preset Prompt Selection

**User Story:** As a venue owner, I want to choose from 11 preset prompts describing common music vibes (including Vietnamese-specific options), so that I can quickly configure the AI suggestions without writing a custom prompt.

#### Acceptance Criteria

1. THE Track_Suggestions_Tab SHALL display 11 Preset_Prompts as selectable options in the Admin_Dashboard
2. WHEN a venue owner selects a Preset_Prompt, THE Track_Suggestions_Tab SHALL set that prompt as the active prompt for the AI_Suggestion_Service
3. THE Track_Suggestions_Tab SHALL visually indicate which Preset_Prompt is currently active
4. THE Admin_Dashboard SHALL persist the selected Preset_Prompt to localStorage so that the selection survives page reloads

### Requirement 3: Custom Prompt Input

**User Story:** As a venue owner, I want to write my own custom prompt for the AI, so that I can tailor song suggestions to specific events or unique vibes that presets do not cover.

#### Acceptance Criteria

1. THE Track_Suggestions_Tab SHALL provide a text input field where the venue owner can enter a Custom_Prompt
2. WHEN a venue owner enters a Custom_Prompt, THE Track_Suggestions_Tab SHALL use the Custom_Prompt as the active prompt instead of any selected Preset_Prompt
3. WHEN a venue owner clears the Custom_Prompt field, THE Track_Suggestions_Tab SHALL revert to the previously selected Preset_Prompt
4. THE Admin_Dashboard SHALL persist the Custom_Prompt to localStorage so that the text survives page reloads
5. IF the Custom_Prompt exceeds 500 characters, THEN THE Track_Suggestions_Tab SHALL truncate the prompt to 500 characters and display a character count indicator

### Requirement 4: Batch Suggestion Processing

**User Story:** As a venue owner, I want the AI to suggest 10 songs at a time, so that the system does not call the AI after every single song plays and reduces API usage.

#### Acceptance Criteria

1. WHEN the AutoPlay_Service triggers a suggestion request, THE AI_Suggestion_Service SHALL request exactly 10 songs from Venice AI in a single API call
2. WHEN the AI_Suggestion_Service receives a Suggestion_Batch, THE AutoPlay_Service SHALL add the resolved tracks to the Queue one by one until the Queue reaches the auto-fill target size
3. WHILE the Queue contains tracks from a previous Suggestion_Batch that have not yet been added, THE AutoPlay_Service SHALL use those remaining tracks before requesting a new Suggestion_Batch
4. THE AutoPlay_Service SHALL continue to monitor Queue size and trigger new Suggestion_Batch requests when the Queue drops below the configured auto-fill target size

### Requirement 5: Recently Played Song Exclusion

**User Story:** As a venue owner, I want the AI to avoid suggesting songs that were recently played, so that patrons do not hear the same songs repeated in a short period.

#### Acceptance Criteria

1. THE AI_Suggestion_Service SHALL maintain a Recently_Played_List of the 100 most recently played song Spotify track IDs
2. WHEN constructing the AI prompt, THE AI_Suggestion_Service SHALL include the Recently_Played_List (song titles and artists) in the prompt context so that Venice AI avoids suggesting those songs
3. WHEN the AI_Suggestion_Service receives suggestions from Venice AI, THE AI_Suggestion_Service SHALL filter out any songs whose resolved Spotify track ID matches an entry in the Recently_Played_List
4. WHEN a new song is played, THE AI_Suggestion_Service SHALL add the song to the Recently_Played_List and remove the oldest entry if the list exceeds 100 entries
5. THE AI_Suggestion_Service SHALL persist the Recently_Played_List to the database so that the list survives server restarts

### Requirement 6: Full Removal of Database-Driven Suggestion System

**User Story:** As a venue owner, I want the old database-driven suggestion system fully removed and replaced by the AI system, so that there is a single, consistent suggestion mechanism and no dead code remains in the codebase.

#### Acceptance Criteria

1. THE AutoPlay_Service SHALL use the AI_Suggestion_Service instead of the existing findSuggestedTrack function for all auto-fill operations
2. THE Track_Suggestions_Tab SHALL replace the existing genre, year range, popularity, max song length, and max offset selectors with the new prompt-based UI (preset selection and custom prompt input)
3. THE Track_Suggestions_Tab SHALL retain the auto-fill target size selector since it controls when the AutoPlay_Service triggers new suggestions
4. THE Admin_Dashboard SHALL remove the "Test Suggestion" button that triggers the old database-driven suggestion and replace it with a "Test AI Suggestion" button that triggers the new AI_Suggestion_Service
5. WHEN the new AI suggestion system is active, THE system SHALL stop querying the local tracks table for suggestions
6. THE system SHALL delete the old track suggestion service file (`services/trackSuggestion.ts`) including the findSuggestedTrack function, selectRandomTrack function, filterTracksByCriteria function, and getRandomGenre function
7. THE system SHALL delete the old track suggestions API route (`app/api/track-suggestions/route.ts`) and its server-side cache logic
8. THE system SHALL delete the following old UI components that are no longer needed: genres-selector, year-range-selector, popularity-selector, max-song-length-selector, max-offset-selector, and explicit-content-toggle from the track-suggestions components directory
9. THE system SHALL delete the old useTrackSuggestions hook (`app/[username]/admin/components/track-suggestions/hooks/useTrackSuggestions.ts`) that manages the old genre/year/popularity state
10. THE system SHALL delete the old TrackSuggestionsState type and isValidTrackSuggestionsState type guard from `shared/types/trackSuggestions.ts` and replace them with a new AI-oriented state type containing prompt text, selected preset identifier, custom prompt text, and auto-fill target size
11. THE system SHALL delete the old track suggestion validation logic (`shared/validations/trackSuggestion.ts`) including validateTrackSuggestionParams and validateExcludedTrackIds functions
12. THE system SHALL delete the suggestionsCooldown utility (`shared/utils/suggestionsCooldown.ts`) including loadCooldownState, saveCooldownState, getTracksInCooldown, filterEligibleTrackIds, recordTrackAddition, and getCooldownInfo functions, since the Recently_Played_List (last 100 songs) replaces the 24-hour cooldown mechanism
13. THE system SHALL remove the following constants from `shared/constants/trackSuggestion.ts` that are only used by the old system: FALLBACK_GENRES, ALL_SPOTIFY_GENRES, POPULAR_GENRES, DEFAULT_MAX_SONG_LENGTH_MINUTES, DEFAULT_MAX_OFFSET, DEFAULT_MAX_GENRE_ATTEMPTS, DEFAULT_YEAR_RANGE, TRACK_REPEAT_COOLDOWN_HOURS, MIN_POPULARITY, MAX_POPULARITY, MIN_SONG_LENGTH_MINUTES, MAX_SONG_LENGTH_MINUTES, MIN_YEAR, MAX_YEAR, COOLDOWN_MS, INTERVAL_MS, DEBOUNCE_MS, MIN_TRACK_POPULARITY, MIN_TRACK_POPULARITY_INCLUSIVE, MIN_TRACK_POPULARITY_VERY_INCLUSIVE, MIN_TRACK_POPULARITY_OBSCURE, MAX_PLAYLIST_LENGTH, and TRACK_SEARCH_LIMIT
14. THE system SHALL remove all imports of deleted modules from any remaining files and verify that no compile errors result from the removals

### Requirement 7: AI Suggestion API Endpoint

**User Story:** As a developer, I want a dedicated API endpoint for AI-powered suggestions, so that the AutoPlay_Service can request AI suggestions through a clean server-side interface.

#### Acceptance Criteria

1. THE system SHALL expose a POST endpoint at `/api/ai-suggestions` that accepts a prompt string, an auto-fill target size, and a list of excluded track IDs
2. THE `/api/ai-suggestions` endpoint SHALL validate the request body using Zod, requiring a non-empty prompt string and an array of excluded track IDs
3. WHEN the endpoint receives a valid request, THE `/api/ai-suggestions` endpoint SHALL call the AI_Suggestion_Service and return the resolved Spotify track IDs in the response
4. IF the request body fails Zod validation, THEN THE `/api/ai-suggestions` endpoint SHALL return a 400 status with descriptive validation errors
5. IF the AI_Suggestion_Service fails, THEN THE `/api/ai-suggestions` endpoint SHALL return a 500 status with an error message and log the failure using createModuleLogger

### Requirement 8: Suggestion State Management

**User Story:** As a venue owner, I want my suggestion configuration (selected preset, custom prompt, auto-fill target) to persist across sessions, so that I do not have to reconfigure the system every time I open the admin dashboard.

#### Acceptance Criteria

1. THE Track_Suggestions_Tab SHALL define a new state interface containing the active prompt text, the selected preset identifier, the custom prompt text, and the auto-fill target size
2. THE Track_Suggestions_Tab SHALL persist the suggestion state to localStorage using a dedicated storage key
3. WHEN the Admin_Dashboard loads, THE Track_Suggestions_Tab SHALL restore the suggestion state from localStorage
4. WHEN the suggestion state changes, THE Track_Suggestions_Tab SHALL propagate the updated prompt to the AutoPlay_Service within 1 second

### Requirement 9: Architecture Refactoring and Separation of Concerns

**User Story:** As a developer, I want the auto-play and suggestion architecture cleanly separated into focused modules, so that the codebase is maintainable, testable, and each concern can evolve independently.

#### Acceptance Criteria

1. THE AI_Suggestion_Service SHALL be implemented as a standalone service module (e.g. `services/aiSuggestion.ts`) that is not embedded within the AutoPlay_Service class
2. THE AutoPlay_Service SHALL delegate all song suggestion logic to the AI_Suggestion_Service through a clean interface, rather than containing suggestion parameter merging, validation, or API call logic inline
3. THE AutoPlay_Service SHALL remove all old track suggestion parameter merging logic including the mergedTrackSuggestions object construction that combines genres, yearRange, popularity, allowExplicit, maxSongLength, and maxOffset with fallback defaults
4. THE AutoPlay_Service SHALL remove the import and usage of FALLBACK_GENRES, DEFAULT_YEAR_RANGE, MIN_TRACK_POPULARITY, DEFAULT_MAX_SONG_LENGTH_MINUTES, and DEFAULT_MAX_OFFSET from `shared/constants/trackSuggestion.ts`
5. THE AutoPlay_Service SHALL remove the import and usage of TrackSuggestionsState and isValidTrackSuggestionsState from `shared/types/trackSuggestions.ts`
6. THE AutoPlay_Service SHALL remove the import and usage of TrackDuplicateDetector for suggestion-related duplicate detection, since the Recently_Played_List in the AI_Suggestion_Service handles repeat prevention
7. THE AutoPlay_Service SHALL remove the suggestionsCooldown import and all cooldown state loading, recording, and saving logic from the autoFillQueue method
8. THE AutoPlay_Service SHALL remove the trackSuggestionsState property and the setTrackSuggestionsState method, replacing them with a simpler interface that accepts only the active prompt string and auto-fill target size
9. THE AutoPlay_Service SHALL retain its core responsibilities of queue monitoring, auto-fill triggering, playback state polling, and track transition handling
10. THE AI_Suggestion_Service SHALL expose a clear interface that accepts a prompt string and a list of excluded track IDs, and returns resolved Spotify track IDs
11. THE system SHALL ensure that the queue monitoring concern (when to request suggestions), the suggestion fetching concern (how to get suggestions from AI), and the queue population concern (how to add tracks to the queue) are handled by separate, focused modules or clearly separated methods
