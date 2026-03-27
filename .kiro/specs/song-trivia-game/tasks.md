# Implementation Plan: Song Trivia Game

## Overview

Replace the existing DGS music game with a song trivia game. Implementation proceeds bottom-up: database schema and migrations first, then shared validation schemas, API routes, React hooks, UI components, and finally wiring everything together in the game page.

## Tasks

- [x] 1. Create database schema and migrations
  - [x] 1.1 Apply Supabase migration for `trivia_questions` table
    - Use the Supabase MCP `apply_migration` tool to apply the `trivia_questions` table DDL
    - Include UUID primary key, `profile_id` FK to profiles, `spotify_track_id`, `question`, `options` (JSONB), `correct_index` (SMALLINT 0–3), `created_at`
    - Add UNIQUE constraint on `(profile_id, spotify_track_id)`
    - Add index `idx_trivia_questions_lookup` on `(profile_id, spotify_track_id)`
    - Enable RLS with public SELECT and service_role ALL policies
    - _Requirements: 8.1, 8.2_

  - [x] 1.2 Apply Supabase migration for `trivia_scores` table
    - Use the Supabase MCP `apply_migration` tool to apply the `trivia_scores` table DDL
    - Include UUID primary key, `profile_id` FK, `session_id`, `player_name` (1–20 chars), `score` (integer >= 0), `first_score_at`, `updated_at`
    - Add UNIQUE constraint on `(profile_id, session_id)`
    - Add index `idx_trivia_scores_leaderboard` on `(profile_id, score DESC, first_score_at ASC)`
    - Set `REPLICA IDENTITY FULL` for Realtime subscriptions
    - Enable RLS with public SELECT and service_role ALL policies
    - _Requirements: 3.2, 5.1, 5.3_

  - [ ] 1.3 Apply Supabase migration for `trivia_determine_winner_and_reset` RPC function
    - Use the Supabase MCP `apply_migration` tool to apply the PL/pgSQL function
    - Function atomically selects the top scorer (highest score, earliest `first_score_at` for ties), deletes all rows for the venue, and returns the winner
    - _Requirements: 6.1, 6.3, 6.4_

- [ ] 2. Create shared validation schemas and types
  - [ ] 2.1 Create Zod validation schemas in `shared/validations/trivia.ts`
    - Define `triviaQuestionRequestSchema` (profile_id uuid, spotify_track_id, track_name, artist_name, album_name — all non-empty strings)
    - Define `triviaQuestionResponseSchema` (question, options as 4-string tuple, correctIndex 0–3)
    - Define `scoreSubmitRequestSchema` (profile_id uuid, session_id non-empty, player_name 1–20 chars)
    - Define `resetRequestSchema` (profile_id uuid)
    - Export inferred TypeScript types from each schema
    - _Requirements: 1.2, 1.5, 1.6, 3.2, 4.3_

  - [ ] 2.2 Write property tests for Zod validation schemas
    - **Property 1: Valid trivia responses always have exactly 4 options and correctIndex 0–3**
    - **Validates: Requirements 1.2, 1.5**
    - Create test file at `shared/validations/__tests__/trivia.test.ts`
    - Use `node:test` and `node:assert`

- [x] 3. Implement trivia question generation API
  - [x] 3.1 Create `POST /api/trivia/route.ts` for question generation
    - Parse and validate request body with `triviaQuestionRequestSchema`
    - Check `trivia_questions` table for cached question matching `(profile_id, spotify_track_id)`
    - If cached, return the cached question
    - If not cached, call Venice AI (`llama-3.3-70b`) with the music trivia system prompt from the design
    - Parse Venice AI JSON response and validate with `triviaQuestionResponseSchema`
    - Shuffle options array and update `correctIndex` accordingly
    - Cache the question in `trivia_questions` via `supabaseAdmin`
    - Return the question response
    - Handle Venice AI errors with descriptive error messages
    - Use `createModuleLogger` for logging
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 8.1, 8.2_

  - [x] 3.2 Write unit tests for trivia question generation
    - Test cache hit returns cached question without calling Venice AI
    - Test option shuffling produces valid correctIndex
    - Test Venice AI error handling returns proper error response
    - Test Zod validation rejects malformed requests
    - Create test file at `app/api/trivia/__tests__/route.test.ts`
    - _Requirements: 1.2, 1.3, 1.4, 8.2_

- [/] 4. Implement score submission API
  - [ ] 4.1 Create `POST /api/trivia/scores/route.ts` for score submission
    - Parse and validate request body with `scoreSubmitRequestSchema`
    - Upsert into `trivia_scores`: increment `score` by 1, update `player_name`, set `first_score_at` to `now()` if currently null
    - Return `{ success: true, new_score }` on success
    - Use `supabaseAdmin` for database operations
    - Use `createModuleLogger` for logging
    - _Requirements: 3.2, 4.3, 7.4_

  - [ ] 4.2 Write unit tests for score submission
    - Test valid score submission returns incremented score
    - Test Zod validation rejects invalid player names (empty, >20 chars)
    - Test upsert behavior (new player vs existing player)
    - Create test file at `app/api/trivia/scores/__tests__/route.test.ts`
    - _Requirements: 3.2, 4.3_

- [ ] 5. Implement hourly reset API
  - [ ] 5.1 Create `POST /api/trivia/reset/route.ts` for hourly reset
    - Parse and validate request body with `resetRequestSchema`
    - Call Supabase RPC `trivia_determine_winner_and_reset(p_profile_id)`
    - If winner exists, upsert a DJ announcement into `dj_announcements` with a winner congratulations script text and `is_active: true`
    - Return `{ winner, reset: true }` or `{ winner: null, reset: true }`
    - Use `supabaseAdmin` for database operations
    - Use `createModuleLogger` for logging
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ] 5.2 Write unit tests for hourly reset
    - Test winner determination returns correct winner data
    - Test null winner when no scores exist
    - Test DJ announcement is created when winner exists
    - Create test file at `app/api/trivia/reset/__tests__/route.test.ts`
    - _Requirements: 6.1, 6.3, 6.4_

- [ ] 6. Checkpoint — Verify API layer
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement React hooks
  - [x] 7.1 Create `useTriviaGame` hook in `hooks/trivia/useTriviaGame.ts`
    - Accept `profileId` and `username` as options
    - Manage player session: generate `sessionId` (crypto.randomUUID) and store with `playerName` in localStorage
    - Expose `hasJoined`, `joinGame(name)`, `setPlayerName(name)` for name entry flow
    - Listen to `useNowPlayingRealtime` for `spotify_track_id` changes
    - On song change, fetch question from `/api/trivia` (POST with track metadata)
    - Manage `question`, `selectedAnswer`, `isCorrect`, `isLoading`, `error` state
    - `selectAnswer(index)`: compare against `correctIndex`, set `isCorrect`, if correct POST to `/api/trivia/scores`
    - Prevent multiple answer selections per question
    - Track `score` locally (increment on correct answer)
    - Compute `timeUntilReset` countdown (seconds until next XX:00:00), update every second via `setInterval`
    - At hour boundary, POST to `/api/trivia/reset` and reset local score
    - Clear previous answer state on song change
    - _Requirements: 1.1, 2.1, 2.2, 2.3, 2.5, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.4, 4.5, 6.5, 7.1, 8.3, 8.4_

  - [x] 7.2 Create `useTriviaLeaderboard` hook in `hooks/trivia/useTriviaLeaderboard.ts`
    - Accept `profileId` as option
    - Initial fetch: query `trivia_scores` where `profile_id` matches and `score > 0`, ordered by score DESC then `first_score_at` ASC
    - Subscribe to Supabase Realtime `postgres_changes` on `trivia_scores` filtered by `profile_id`
    - On INSERT/UPDATE/DELETE events, re-fetch the full leaderboard
    - Return `entries` (sorted) and `isLoading`
    - Follow the same Realtime subscription pattern as `useNowPlayingRealtime` and `useDjSubtitles`
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 6.6_

  - [x] 7.3 Write unit tests for session management logic
    - Extract session persistence logic into a pure helper (e.g., `getOrCreateSession`, `updateSessionName`)
    - Test that `getOrCreateSession` returns existing session from storage
    - Test that `getOrCreateSession` creates new session when none exists
    - Test that player name updates are persisted
    - Create test file at `hooks/trivia/__tests__/session.test.ts`
    - _Requirements: 4.1, 4.2, 4.4_

- [x] 8. Implement UI components
  - [ ] 8.1 Create `NowPlayingHeader` component in `app/[username]/game/components/NowPlayingHeader.tsx`
    - Display album art, song name, and artist name
    - Show a waiting state when no song is playing (requirement 2.4)
    - Responsive layout for mobile (min 320px viewport)
    - _Requirements: 9.1, 9.6, 2.4_

  - [ ] 8.2 Create `TriviaQuestion` component in `app/[username]/game/components/TriviaQuestion.tsx`
    - Display question text prominently
    - Render 4 answer option buttons arranged vertically
    - On answer selection: highlight correct answer green, incorrect answer red (requirements 3.1, 3.5)
    - Disable all buttons after an answer is selected (requirement 3.3)
    - Show loading indicator while question is being fetched (requirement 2.3)
    - _Requirements: 9.2, 9.3, 3.1, 3.3, 3.5, 2.3_

  - [ ] 8.3 Create `PlayerScore` component in `app/[username]/game/components/PlayerScore.tsx`
    - Display current player score
    - Display countdown timer showing time until next hourly reset (MM:SS format)
    - _Requirements: 3.4, 6.5_

  - [ ] 8.4 Create `Leaderboard` component in `app/[username]/game/components/Leaderboard.tsx`
    - Render a collapsible section with ranked player list
    - Highlight the current player entry (match by `sessionId`)
    - Show player rank, name, and score
    - Order by score descending, then earliest `first_score_at` for ties
    - _Requirements: 9.4, 5.1, 5.2, 5.4, 5.5_

  - [ ] 8.5 Create `NameEntryModal` component in `app/[username]/game/components/NameEntryModal.tsx`
    - Modal overlay prompting for display name on first visit
    - Input field with 1–20 character validation
    - Submit button to join the game
    - _Requirements: 4.1, 4.3_

- [ ] 9. Checkpoint — Verify components render
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Wire everything together in the game page
  - [ ] 10.1 Replace `app/[username]/game/page.tsx` with trivia game page
    - Remove all existing DGS game imports and logic
    - Use `useParams` to get `username`, `useProfileId` to resolve `profileId`
    - Initialize `useTriviaGame` and `useTriviaLeaderboard` hooks
    - Compose page layout: `NameEntryModal` (shown when `!hasJoined`) → `NowPlayingHeader` → `TriviaQuestion` → `PlayerScore` → `Leaderboard`
    - Pass all props from hooks to child components
    - Handle loading and error states for profile resolution
    - Ensure the page is fully responsive (min 320px viewport)
    - _Requirements: 7.1, 7.2, 7.3, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [ ] 10.2 Clean up old DGS game files
    - Remove old game components from `app/[username]/game/components/` that are no longer used (GameBoard, GameOptionNode, GameOptionSkeleton, PlayerHud, ScoreAnimation, TurnTimer, DgsDebugPanel, ArtistSelectionModal, LoadingProgressBar)
    - Remove old game hooks from `hooks/game/` if no longer referenced elsewhere
    - Remove old game services from `services/game/` if no longer referenced elsewhere
    - _Requirements: N/A (cleanup)_

- [ ] 11. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- The design uses TypeScript throughout — all implementation uses TypeScript with strict mode
- Use `node:test` runner with `tsx` for all tests (no Jest/Vitest)
- Use `createModuleLogger` for logging in non-React files; never use `console.log`
- Follow existing code style: single quotes, no semicolons, no trailing commas
