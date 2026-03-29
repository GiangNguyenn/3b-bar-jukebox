# Requirements Document

## Introduction

Remove the deprecated DGS (Dual Gravity System) game code from the project. The game page has been replaced by a Song Trivia Game (see `song-trivia-game` spec). The old DGS code — including its engine, scoring, caching, hooks, API routes, and UI components — is no longer used by the game page but remains in the codebase, causing console errors (e.g., `supabase-admin.ts` throwing on missing env vars when `dgsCache.ts` is imported client-side via `genreBackfill.ts`). Some files in `services/game/` are shared with non-game systems (genre backfill used by search and track upsert, metadata backfill used by the admin dashboard). These shared utilities must be preserved or relocated. The goal is to eliminate dead code, resolve the console error, and leave the codebase clean.

## Glossary

- **DGS_Code**: The deprecated Dual Gravity System game engine and all files exclusively supporting it, including `dgsEngine.ts`, `dgsScoring.ts`, `dgsDiversity.ts`, `dgsTypes.ts`, `dgsDb.ts`, `dgsCache.ts`, `clientPipeline.ts`, `artistGraph.ts`, `prepCache.ts`, `lazyUpdateQueue.ts`, `selfHealing.ts`, `debugUtils.ts`, `noopLogger.ts`, `apiStatisticsTracker.ts`, `adminAuth.ts`, `gameRules.ts`, `genreGraph.ts`, `relatedArtistsDb.ts`, and `trackBackfill.ts`
- **DGS_Hooks**: The deprecated React hooks in `hooks/game/` that powered the old DGS game UI: `useMusicGame.ts`, `useGameData.ts`, `useGameRound.ts`, `useGameTimer.ts`, `useBackgroundUpdates.ts`, `usePopularArtists.ts`, `usePlayerNames.ts`
- **DGS_API_Routes**: The deprecated API routes under `app/api/game/` that served the DGS engine: `artists/`, `influence/`, `init-round/`, `lazy-update-tick/`, `options/`, `pipeline/` (stage1-artists, stage2-score-artists, stage3-fetch-tracks), `prep-seed/`
- **DGS_Components**: The deprecated game UI components that are not used by the trivia game page: `ArtistSelectionModal.tsx`, `DgsDebugPanel.tsx`, `GameBoard.tsx`, `GameOptionNode.tsx`, `GameOptionSkeleton.tsx`, `LoadingProgressBar.tsx`, `PlayerHud.tsx`, `ScoreAnimation.tsx`, `TurnTimer.tsx`
- **Shared_Utilities**: Files in `services/game/` that are imported by non-game code and must be preserved: `genreBackfill.ts` (used by `app/api/search/route.ts`, `app/api/tracks/upsert/route.ts`), `metadataBackfill.ts` (used by `hooks/useMetadataBackfill.ts`, `scripts/backfill-metadata.ts`), `genreConstants.ts` (used by `genreBackfill.ts`), `genreSimilarity.ts` (potentially used by trivia or other features)
- **Trivia_Game**: The current Song Trivia Game that replaced DGS, using `hooks/trivia/`, `app/api/trivia/`, and trivia-specific components on the game page
- **Game_Page**: The page at `app/[username]/game/page.tsx` which now exclusively uses Trivia_Game hooks and components
- **Console_Error**: The runtime error `Missing Supabase Service Role environment variables` caused by client-side import of `supabase-admin.ts` through the chain `genreBackfill.ts` → `dgsCache.ts` → `supabase-admin.ts`

## Requirements

### Requirement 1: Remove DGS Engine Services

**User Story:** As a developer, I want the deprecated DGS engine service files removed, so that the codebase contains only active code and the project builds without dead modules.

#### Acceptance Criteria

1. WHEN the cleanup is complete, THE Codebase SHALL contain none of the following files: `services/game/dgsEngine.ts`, `services/game/dgsScoring.ts`, `services/game/dgsDiversity.ts`, `services/game/dgsTypes.ts`, `services/game/dgsDb.ts`, `services/game/clientPipeline.ts`, `services/game/artistGraph.ts`, `services/game/prepCache.ts`, `services/game/lazyUpdateQueue.ts`, `services/game/selfHealing.ts`, `services/game/debugUtils.ts`, `services/game/noopLogger.ts`, `services/game/apiStatisticsTracker.ts`, `services/game/adminAuth.ts`, `services/game/gameRules.ts`, `services/game/genreGraph.ts`, `services/game/relatedArtistsDb.ts`, `services/game/trackBackfill.ts`
2. WHEN the cleanup is complete, THE Codebase SHALL contain none of the test files in `services/game/__tests__/`

### Requirement 2: Remove DGS API Routes

**User Story:** As a developer, I want the deprecated DGS API routes removed, so that the server does not expose unused endpoints.

#### Acceptance Criteria

1. WHEN the cleanup is complete, THE Codebase SHALL contain no files or directories under `app/api/game/`
2. WHEN the cleanup is complete, THE Codebase SHALL retain all files under `app/api/trivia/` unchanged

### Requirement 3: Remove DGS React Hooks

**User Story:** As a developer, I want the deprecated DGS game hooks removed, so that no unused React hooks remain in the project.

#### Acceptance Criteria

1. WHEN the cleanup is complete, THE Codebase SHALL contain no files in the `hooks/game/` directory
2. WHEN the cleanup is complete, THE Codebase SHALL retain all files under `hooks/trivia/` unchanged

### Requirement 4: Remove DGS UI Components

**User Story:** As a developer, I want the deprecated DGS game components removed from the game page directory, so that only trivia-related components remain.

#### Acceptance Criteria

1. WHEN the cleanup is complete, THE Codebase SHALL contain none of the following files: `app/[username]/game/components/ArtistSelectionModal.tsx`, `app/[username]/game/components/DgsDebugPanel.tsx`, `app/[username]/game/components/GameBoard.tsx`, `app/[username]/game/components/GameOptionNode.tsx`, `app/[username]/game/components/GameOptionSkeleton.tsx`, `app/[username]/game/components/LoadingProgressBar.tsx`, `app/[username]/game/components/PlayerHud.tsx`, `app/[username]/game/components/ScoreAnimation.tsx`, `app/[username]/game/components/TurnTimer.tsx`
2. WHEN the cleanup is complete, THE Codebase SHALL retain the following trivia components: `TriviaQuestion.tsx`, `Leaderboard.tsx`, `NameEntryModal.tsx`, `NowPlayingHeader.tsx`, `PlayerScore.tsx`

### Requirement 5: Resolve the Console Error from supabase-admin Client-Side Import

**User Story:** As a developer, I want the console error about missing Supabase Service Role environment variables resolved, so that the client-side application runs without errors.

#### Acceptance Criteria

1. WHEN the cleanup is complete, THE `dgsCache.ts` file SHALL be removed, eliminating the client-side import chain that causes the Console_Error (`genreBackfill.ts` → `dgsCache.ts` → `supabase-admin.ts`)
2. WHEN the cleanup is complete, THE `genreBackfill.ts` file SHALL import `upsertArtistProfile` from a server-safe location instead of from `dgsCache.ts`
3. IF `genreBackfill.ts` is only invoked from server-side API routes after cleanup, THEN THE import chain SHALL remain server-only and not be bundled into client code
4. WHEN the cleanup is complete, THE Game_Page SHALL load without triggering the `Missing Supabase Service Role environment variables` error

### Requirement 6: Preserve Shared Utilities

**User Story:** As a developer, I want the genre backfill and metadata backfill utilities preserved, so that search results and track metadata enrichment continue to work.

#### Acceptance Criteria

1. WHEN the cleanup is complete, THE `genreBackfill.ts` file SHALL remain functional and importable by `app/api/search/route.ts` and `app/api/tracks/upsert/route.ts`
2. WHEN the cleanup is complete, THE `metadataBackfill.ts` file SHALL remain functional and importable by `hooks/useMetadataBackfill.ts` and `scripts/backfill-metadata.ts`
3. WHEN the cleanup is complete, THE `genreConstants.ts` file SHALL remain available as a dependency of `genreBackfill.ts`
4. WHEN the cleanup is complete, THE `upsertArtistProfile` function currently in `dgsCache.ts` SHALL be relocated to a standalone module (e.g., `services/game/artistCache.ts` or `lib/artistCache.ts`) so that `genreBackfill.ts` and `app/api/tracks/upsert/route.ts` can import it without pulling in DGS_Code

### Requirement 7: Clean Up gameService.ts and musicService.ts Dependencies

**User Story:** As a developer, I want the shared service files cleaned of DGS-specific imports, so that they do not reference deleted modules.

#### Acceptance Criteria

1. WHEN the cleanup is complete, THE `services/musicService.ts` file SHALL contain no imports from deleted DGS_Code files (specifically `dgsTypes.ts`, `dgsCache.ts`, `dgsDb.ts`, `artistGraph.ts`)
2. WHEN the cleanup is complete, THE `services/gameService.ts` file SHALL be evaluated for removal if its only consumers were DGS_API_Routes; IF it is still used by non-DGS code, THEN it SHALL be retained with DGS-specific exports removed
3. WHEN the cleanup is complete, THE project SHALL pass `yarn build` without import resolution errors referencing deleted files

### Requirement 8: Verify Build and Runtime Integrity

**User Story:** As a developer, I want the project to build and run correctly after the cleanup, so that no regressions are introduced.

#### Acceptance Criteria

1. WHEN the cleanup is complete, THE project SHALL pass `yarn build` with zero errors
2. WHEN the cleanup is complete, THE project SHALL pass `yarn lint:check` with no new lint errors introduced by the cleanup
3. WHEN the cleanup is complete, THE Game_Page SHALL render the Song Trivia Game correctly with no missing component or hook errors
4. WHEN the cleanup is complete, THE admin dashboard metadata backfill (via `useMetadataBackfill`) SHALL continue to function without errors
