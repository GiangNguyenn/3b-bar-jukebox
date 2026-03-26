# Implementation Plan: AI Song Suggestions

## Overview

Replace the database-driven track suggestion system with an AI-powered approach using Venice AI. Implementation proceeds bottom-up: shared types/constants first, then the server-side AI service and API endpoint, then the database migration, then the new UI components and hook, then AutoPlayService simplification, and finally full removal of old code. Each step builds on the previous and ends with wiring into the existing system.

## Tasks

- [x] 1. Create shared types and constants for AI suggestions
  - [x] 1.1 Create `shared/types/aiSuggestions.ts` with `AiSuggestionsState` interface
    - Define `AiSuggestionsState` with `selectedPresetId: string | null`, `customPrompt: string`, `autoFillTargetSize: number`
    - Export `AiSongRecommendation` interface with `title: string` and `artist: string`
    - Export `AiSuggestionResult` interface with `tracks` array and `failedResolutions` array
    - Export `RecentlyPlayedEntry` interface with `spotifyTrackId`, `title`, `artist`
    - _Requirements: 8.1, 1.2_

  - [x] 1.2 Create `shared/constants/aiSuggestion.ts` with 11 preset prompts
    - Define `PresetPrompt` interface with `id`, `label`, `emoji`, `prompt` fields
    - Export `PRESET_PROMPTS` array with all 11 presets (party, chill, rock, throwback, indie, hiphop, electronic, acoustic, vpop, vrock, punk-metal)
    - Export `MAX_CUSTOM_PROMPT_LENGTH = 500` and `SUGGESTION_BATCH_SIZE = 10`
    - Export `AI_SUGGESTIONS_STORAGE_KEY = 'ai-suggestions-state'`
    - _Requirements: 2.1, 3.5, 4.1_

  - [x] 1.3 Write property test for active prompt derivation (Property 4)
    - **Property 4: Active prompt derivation from preset and custom prompt**
    - **Validates: Requirements 2.2, 3.2, 3.3**

  - [x] 1.4 Write property test for custom prompt truncation (Property 6)
    - **Property 6: Custom prompt truncation at 500 characters**
    - **Validates: Requirements 3.5**

  - [x] 1.5 Write property test for state localStorage round-trip (Property 5)
    - **Property 5: Suggestion state localStorage round-trip**
    - **Validates: Requirements 2.4, 3.4, 8.2, 8.3**

- [x] 2. Implement AI Suggestion Service (`services/aiSuggestion.ts`)
  - [x] 2.1 Create `services/aiSuggestion.ts` with Venice AI integration
    - Implement `getAiSuggestions(prompt, excludedTrackIds, recentlyPlayed)` function
    - Build system message instructing Venice AI to return exactly 10 songs as JSON array
    - Build user message including the prompt and recently played list for exclusion
    - Use `fetch` to `https://api.venice.ai/api/v1/chat/completions` with `llama-3.3-70b` model
    - Apply `AbortSignal.timeout(25000)` for 25-second timeout
    - Parse Venice AI JSON response into `AiSongRecommendation[]`
    - Handle partial responses (fewer than 10 recommendations) gracefully without retrying
    - Use `createModuleLogger('AISuggestion')` for all logging
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 5.2_

  - [x] 2.2 Implement Spotify track resolution in `services/aiSuggestion.ts`
    - Implement `resolveToSpotifyTrack(title, artist)` using `sendApiRequest` with `useAppToken: true`
    - Construct search query as `track:{title} artist:{artist}` with `type=track&limit=1&market=VN`
    - Return Spotify track ID on success, `null` on failure
    - In `getAiSuggestions`, resolve each recommendation and collect `failedResolutions`
    - Filter out any resolved track IDs that appear in the recently played list or excluded list
    - _Requirements: 1.3, 5.3_

  - [x] 2.3 Implement recently played list management in `services/aiSuggestion.ts`
    - Implement `getRecentlyPlayed(profileId)` querying `recently_played_tracks` table ordered by `played_at DESC` limit 100
    - Implement `addToRecentlyPlayed(profileId, entry)` using upsert on `(profile_id, spotify_track_id)` and deleting oldest entries beyond 100
    - Use Supabase client from `@/lib/supabase`
    - Handle database errors gracefully: reads return empty list, writes log and continue
    - _Requirements: 5.1, 5.4, 5.5_

  - [x] 2.4 Write property test for Venice AI response parsing (Property 1)
    - **Property 1: Venice AI response parsing yields valid recommendations**
    - **Validates: Requirements 1.2**

  - [x] 2.5 Write property test for Spotify search query construction (Property 2)
    - **Property 2: Spotify search query construction includes title and artist**
    - **Validates: Requirements 1.3**

  - [x] 2.6 Write property test for graceful degradation on partial responses (Property 3)
    - **Property 3: Graceful degradation on partial AI responses**
    - **Validates: Requirements 1.5**

  - [x] 2.7 Write property test for post-resolution filtering (Property 11)
    - **Property 11: Post-resolution filtering excludes recently played tracks**
    - **Validates: Requirements 5.3**

  - [x] 2.8 Write property test for recently played size invariant (Property 9)
    - **Property 9: Recently played list size invariant**
    - **Validates: Requirements 5.1, 5.4**

  - [x] 2.9 Write property test for prompt includes recently played context (Property 10)
    - **Property 10: AI prompt includes recently played context**
    - **Validates: Requirements 5.2**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Create AI Suggestions API endpoint and database migration
  - [x] 4.1 Create Supabase migration for `recently_played_tracks` table
    - Create migration file in `supabase/migrations/` with timestamp prefix
    - Define table with `id uuid`, `profile_id uuid` (FK to profiles), `spotify_track_id text`, `title text`, `artist text`, `played_at timestamptz`
    - Add `UNIQUE(profile_id, spotify_track_id)` constraint for upsert semantics
    - Add index on `(profile_id, played_at DESC)` for efficient queries
    - _Requirements: 5.1, 5.5_

  - [x] 4.2 Create `app/api/ai-suggestions/route.ts` POST endpoint
    - Define Zod schema requiring `prompt` (non-empty string, max 500 chars), `excludedTrackIds` (string array), `profileId` (string)
    - On valid request: call `getAiSuggestions` from the AI suggestion service, return resolved tracks
    - On Zod validation failure: return 400 with descriptive errors
    - On service failure: return 500 with error message, log via `createModuleLogger`
    - Check `VENICE_AI_API_KEY` env var, return 500 if missing
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 4.3 Write property test for Zod validation (Property 13)
    - **Property 13: API request validation accepts valid and rejects invalid inputs**
    - **Validates: Requirements 7.1, 7.2, 7.4**

  - [x] 4.4 Write property test for recently played DB round-trip (Property 12)
    - **Property 12: Recently played database persistence round-trip**
    - **Validates: Requirements 5.5**

- [x] 5. Implement new UI components and hook
  - [x] 5.1 Create `useAiSuggestions` hook at `app/[username]/admin/components/track-suggestions/hooks/useAiSuggestions.ts`
    - Manage `AiSuggestionsState` with `selectedPresetId`, `customPrompt`, `autoFillTargetSize`
    - Derive `activePrompt`: use `customPrompt.trim()` if non-empty, else look up preset prompt text by `selectedPresetId`
    - Persist state to localStorage under `ai-suggestions-state` key with 1-second debounce
    - Restore state from localStorage on mount with fallback defaults (first preset, empty custom prompt, target size 10)
    - Expose `selectPreset`, `setCustomPrompt`, `setAutoFillTargetSize` callbacks
    - Implement `truncatePrompt` utility that caps strings at 500 characters
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 3.5_

  - [x] 5.2 Create `preset-prompt-selector.tsx` component
    - Render grid of 11 preset prompt cards using `PRESET_PROMPTS` from constants
    - Each card shows emoji and label, with visual active indicator on the selected preset
    - On click, call `selectPreset(presetId)` from the hook
    - Use Tailwind + Radix UI styling consistent with existing admin components
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 5.3 Create `custom-prompt-input.tsx` component
    - Render textarea for custom prompt entry
    - Display character count indicator showing current length vs 500 max
    - Truncate input to 500 characters when exceeded
    - On input change, call `setCustomPrompt` from the hook
    - _Requirements: 3.1, 3.2, 3.5_

  - [x] 5.4 Update `track-suggestions-tab.tsx` with new prompt-based UI
    - Replace old genre/year/popularity/maxSongLength/maxOffset selectors with `PresetPromptSelector` and `CustomPromptInput`
    - Retain `AutoFillTargetSelector` component (unchanged)
    - Replace "Test Suggestion" button with "Test AI Suggestion" button that POSTs to `/api/ai-suggestions`
    - Use `useAiSuggestions` hook instead of old `useTrackSuggestions`
    - Propagate `activePrompt` and `autoFillTargetSize` to parent via `onStateChange` callback
    - Retain `LastSuggestedTrack` display component
    - _Requirements: 6.2, 6.3, 6.4, 2.2, 3.2, 3.3_

- [x] 6. Simplify AutoPlayService to use AI suggestions
  - [x] 6.1 Add suggestion buffer and active prompt to AutoPlayService
    - Add `private activePrompt: string = ''` property
    - Add `private suggestionBuffer: Array<{ id: string; title: string; artist: string }> = []` property
    - Add `public setActivePrompt(prompt: string): void` method
    - Add `public setAutoFillTargetSize(targetSize: number): void` method (update existing `autoFillTargetSize`)
    - _Requirements: 9.8, 4.3_

  - [x] 6.2 Rewrite `autoFillQueue` method to use AI suggestion buffer
    - Check if `suggestionBuffer` has tracks: consume from buffer first (add to queue via existing playlist API)
    - If buffer is empty AND queue < target: POST to `/api/ai-suggestions` with `activePrompt` and excluded track IDs
    - Store unused resolved tracks in `suggestionBuffer` for future use
    - Remove all old `mergedTrackSuggestions` object construction logic
    - Remove old `POST /api/track-suggestions` call
    - Remove `suggestionsCooldown` import and all cooldown state loading/recording/saving
    - _Requirements: 4.2, 4.3, 4.4, 6.1, 9.2, 9.3, 9.7_

  - [x] 6.3 Remove old suggestion-related properties and imports from AutoPlayService
    - Remove `trackSuggestionsState` property and `setTrackSuggestionsState` method
    - Remove import of `FALLBACK_GENRES`, `DEFAULT_YEAR_RANGE`, `MIN_TRACK_POPULARITY`, `DEFAULT_MAX_SONG_LENGTH_MINUTES`, `DEFAULT_MAX_OFFSET`
    - Remove import of `TrackSuggestionsState`, `isValidTrackSuggestionsState`
    - Remove `TrackDuplicateDetector` import and usage for suggestion-related duplicate detection
    - Remove `fallbackToRandomTrack` method's cooldown logic (or simplify if fallback is retained)
    - Update `checkAndAutoFillQueue` to remove old `trackSuggestionsState` validation checks
    - _Requirements: 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

  - [x] 6.4 Write property test for auto-fill adds tracks from buffer up to target (Property 7)
    - **Property 7: Auto-fill adds tracks from buffer up to target size**
    - **Validates: Requirements 4.2, 4.4**

  - [x] 6.5 Write property test for buffer consumed before new batch (Property 8)
    - **Property 8: Buffer is consumed before requesting a new batch**
    - **Validates: Requirements 4.3**

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Delete old suggestion system files and clean up
  - [x] 8.1 Delete old service, API route, and utility files
    - Delete `services/trackSuggestion.ts`
    - Delete `app/api/track-suggestions/route.ts`
    - Delete `shared/validations/trackSuggestion.ts`
    - Delete `shared/utils/suggestionsCooldown.ts`
    - Delete `shared/types/trackSuggestions.ts`
    - _Requirements: 6.6, 6.7, 6.9, 6.10, 6.11, 6.12_

  - [x] 8.2 Delete old UI components
    - Delete `app/[username]/admin/components/track-suggestions/components/genres-selector.tsx`
    - Delete `app/[username]/admin/components/track-suggestions/components/year-range-selector.tsx`
    - Delete `app/[username]/admin/components/track-suggestions/components/popularity-selector.tsx`
    - Delete `app/[username]/admin/components/track-suggestions/components/max-song-length-selector.tsx`
    - Delete `app/[username]/admin/components/track-suggestions/components/max-offset-selector.tsx`
    - Delete `app/[username]/admin/components/track-suggestions/components/explicit-content-toggle.tsx`
    - Delete `app/[username]/admin/components/track-suggestions/hooks/useTrackSuggestions.ts`
    - _Requirements: 6.8, 6.9_

  - [x] 8.3 Clean up old constants from `shared/constants/trackSuggestion.ts`
    - Remove `COOLDOWN_MS`, `INTERVAL_MS`, `DEBOUNCE_MS`, `MIN_TRACK_POPULARITY`, `MIN_TRACK_POPULARITY_INCLUSIVE`, `MIN_TRACK_POPULARITY_VERY_INCLUSIVE`, `MIN_TRACK_POPULARITY_OBSCURE`
    - Remove `FALLBACK_GENRES`, `ALL_SPOTIFY_GENRES`, `POPULAR_GENRES`
    - Remove `MAX_PLAYLIST_LENGTH`, `TRACK_SEARCH_LIMIT`, `DEFAULT_MAX_SONG_LENGTH_MINUTES`, `DEFAULT_MAX_OFFSET`, `DEFAULT_MAX_GENRE_ATTEMPTS`, `DEFAULT_YEAR_RANGE`
    - Remove `TRACK_REPEAT_COOLDOWN_HOURS`, `MIN_POPULARITY`, `MAX_POPULARITY`, `MIN_SONG_LENGTH_MINUTES`, `MAX_SONG_LENGTH_MINUTES`, `MIN_YEAR`, `MAX_YEAR`
    - Retain `DEFAULT_MARKET`, `SPOTIFY_SEARCH_ENDPOINT`, and `Genre` type if still used elsewhere; otherwise delete the file
    - _Requirements: 6.13_

  - [x] 8.4 Remove all stale imports from remaining files and verify no compile errors
    - Search codebase for imports of deleted modules (`trackSuggestion`, `trackSuggestions`, `useTrackSuggestions`, `suggestionsCooldown`, old component imports)
    - Remove or replace all stale imports
    - Run `yarn lint:check` and `yarn build` to verify no compile errors
    - _Requirements: 6.14_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties using fast-check with Node.js built-in test runner
- Unit tests validate specific examples and edge cases
- The implementation uses TypeScript throughout, matching the existing codebase
