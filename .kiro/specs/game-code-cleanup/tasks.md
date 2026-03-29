# Implementation Plan: Game Code Cleanup

## Overview

Remove the deprecated DGS game engine code following a 5-phase dependency-aware approach: extract shared functions into new modules, rewire imports, clean dependent services, delete dead code, and verify the build. Each phase ensures no dangling imports exist before proceeding to the next.

## Tasks

- [x] 1. Phase 1: Extract & Relocate shared functions into new modules

  - [x] 1.1 Create `services/game/artistCache.ts` with `upsertArtistProfile`, `batchUpsertArtistProfiles`, and `batchGetArtistProfilesWithCache` extracted from `dgsCache.ts`

    - Copy the function implementations from `dgsCache.ts` along with their required imports (`supabaseAdmin`, `supabase`, `queryWithRetry`, `sendApiRequest`, `createModuleLogger`)
    - Include the `CachedArtistProfile` interface and `isCacheFresh` helper needed by `batchGetArtistProfilesWithCache`
    - Include the `CACHE_TTL_DAYS` constant
    - The module must import `backfillArtistGenres` and `safeBackfillArtistGenres` from `./genreBackfill` (same as `dgsCache.ts` did)
    - Export the `ApiStatisticsTracker` type re-imported from `@/shared/apiCallCategorizer` for consumers
    - _Requirements: 5.2, 6.4_

  - [x] 1.2 Create `shared/apiCallCategorizer.ts` with `categorizeApiCall`, `OperationType` type, and `ApiStatisticsTracker` interface extracted from `apiStatisticsTracker.ts`

    - Copy the `OperationType` type alias, the `ApiStatisticsTracker` interface (only the method signatures needed by `shared/api.ts`), and the `categorizeApiCall` function
    - This breaks the `shared/` → `services/game/` dependency
    - _Requirements: 7.1, 7.3_

  - [x] 1.3 Write property test verifying `artistCache.ts` exports match original `dgsCache.ts` signatures
    - **Property 2: All preserved files are retained**
    - **Validates: Requirements 6.1, 6.4**

- [x] 2. Phase 2: Rewire imports in all consumers of extracted functions

  - [x] 2.1 Update `services/game/genreBackfill.ts` to import `upsertArtistProfile` from `./artistCache` instead of `./dgsCache`

    - Change `import { upsertArtistProfile } from './dgsCache'` to `import { upsertArtistProfile } from './artistCache'`
    - _Requirements: 5.2, 6.1_

  - [x] 2.2 Update `services/game/genreSimilarity.ts` to import from `./artistCache` instead of `./dgsCache`

    - Change `import { batchGetArtistProfilesWithCache, batchUpsertArtistProfiles } from './dgsCache'` to import from `./artistCache`
    - Change `import type { ApiStatisticsTracker } from './apiStatisticsTracker'` to import from `@/shared/apiCallCategorizer`
    - _Requirements: 7.1, 6.1_

  - [x] 2.3 Update `shared/api.ts` to import from `./apiCallCategorizer` instead of `../services/game/apiStatisticsTracker`

    - Change `import type { ApiStatisticsTracker } from '../services/game/apiStatisticsTracker'` to `import type { ApiStatisticsTracker } from './apiCallCategorizer'`
    - Change `import { categorizeApiCall } from '../services/game/apiStatisticsTracker'` to `import { categorizeApiCall } from './apiCallCategorizer'`
    - _Requirements: 7.1, 7.3_

  - [x] 2.4 Update `app/api/tracks/upsert/route.ts` to import `upsertArtistProfile` from `@/services/game/artistCache` instead of `@/services/game/dgsCache`
    - Change `import { upsertArtistProfile } from '@/services/game/dgsCache'` to `import { upsertArtistProfile } from '@/services/game/artistCache'`
    - _Requirements: 5.2, 6.4_

- [x] 3. Checkpoint — Verify rewired imports

  - Ensure all tests pass, ask the user if questions arise.
  - Run `yarn build` to confirm no import resolution errors at this stage

- [x] 4. Phase 3: Clean dependent services of DGS-specific imports

  - [x] 4.1 Clean `services/spotifyApiServer.ts` — remove all DGS imports and simplify

    - Remove imports from `./game/dgsCache` (`getCachedRelatedArtists`, `upsertRelatedArtists`, `getCachedTopTracks`, `upsertTopTracks`)
    - Remove imports from `./game/dgsDb` (`fetchTracksByGenreFromDb`, `upsertTrackDetails`)
    - Remove dynamic imports of `./game/artistGraph` and `./game/relatedArtistsDb`
    - Update `import type { ApiStatisticsTracker }` to import from `@/shared/apiCallCategorizer`
    - Simplify `getRelatedArtistsServer` to remove the artist graph and relatedArtistsDb tiers; keep the memory cache and a simple database query or direct Spotify fallback
    - Simplify `getArtistTopTracksServer` to remove `dgsCache` calls; keep memory cache and direct Spotify API call
    - Simplify `searchTracksByGenreServer` to remove `dgsDb` calls; keep direct Spotify API call
    - _Requirements: 7.1, 7.3_

  - [x] 4.2 Clean `services/musicService.ts` — remove all DGS imports and DGS-only methods

    - Remove `import type { DgsOptionTrack } from '@/services/game/dgsTypes'`
    - Remove `import * as dgsCache from './game/dgsCache'`
    - Remove `import * as dgsDb from './game/dgsDb'`
    - Remove `import { getFromArtistGraph, saveToArtistGraph } from './game/artistGraph'`
    - Update `import type { ApiStatisticsTracker }` to import from `@/shared/apiCallCategorizer`
    - Remove the `searchTracksByGenre` method (DGS-only, uses `DgsOptionTrack`)
    - Simplify remaining methods (`getArtist`, `getTrack`, `getTopTracks`, `getRelatedArtists`) to use `spotifyApiServer` directly without `dgsCache`/`dgsDb` intermediaries
    - _Requirements: 7.1, 7.2_

  - [x] 4.3 Write property test: no surviving source file imports a deleted DGS module
    - **Property 3: No surviving source file imports a deleted module**
    - Parse all `.ts`/`.tsx` files remaining after cleanup and assert none contain import paths referencing: `dgsCache`, `dgsDb`, `dgsTypes`, `artistGraph`, `apiStatisticsTracker`, `dgsEngine`, `dgsScoring`, `dgsDiversity`, `clientPipeline`, `prepCache`, `lazyUpdateQueue`, `selfHealing`, `debugUtils`, `noopLogger`, `adminAuth`, `gameRules`, `genreGraph`, `relatedArtistsDb`, `trackBackfill`
    - **Validates: Requirements 5.2, 7.1, 7.3**

- [x] 5. Checkpoint — Verify cleaned services

  - Ensure all tests pass, ask the user if questions arise.
  - Run `yarn build` to confirm no import resolution errors before deletion phase

- [x] 6. Phase 4: Delete all dead DGS code

  - [x] 6.1 Delete DGS engine service files from `services/game/`

    - Delete: `dgsEngine.ts`, `dgsScoring.ts`, `dgsDiversity.ts`, `dgsTypes.ts`, `dgsDb.ts`, `dgsCache.ts`, `clientPipeline.ts`, `artistGraph.ts`, `prepCache.ts`, `lazyUpdateQueue.ts`, `selfHealing.ts`, `debugUtils.ts`, `noopLogger.ts`, `apiStatisticsTracker.ts`, `adminAuth.ts`, `gameRules.ts`, `genreGraph.ts`, `relatedArtistsDb.ts`, `trackBackfill.ts`
    - _Requirements: 1.1_

  - [x] 6.2 Delete DGS test files from `services/game/__tests__/`

    - Delete the entire `services/game/__tests__/` directory
    - _Requirements: 1.2_

  - [x] 6.3 Delete DGS API routes from `app/api/game/`

    - Delete the entire `app/api/game/` directory (includes `artists/`, `influence/`, `init-round/`, `lazy-update-tick/`, `options/`, `pipeline/`, `prep-seed/`)
    - _Requirements: 2.1_

  - [x] 6.4 Delete DGS React hooks from `hooks/game/`

    - Delete the entire `hooks/game/` directory (includes `useMusicGame.ts`, `useGameData.ts`, `useGameRound.ts`, `useGameTimer.ts`, `useBackgroundUpdates.ts`, `usePopularArtists.ts`, `usePlayerNames.ts`)
    - _Requirements: 3.1_

  - [x] 6.5 Delete DGS UI components from `app/[username]/game/components/`
    - Delete: `ArtistSelectionModal.tsx`, `DgsDebugPanel.tsx`, `GameBoard.tsx`, `GameOptionNode.tsx`, `GameOptionSkeleton.tsx`, `LoadingProgressBar.tsx`, `PlayerHud.tsx`, `ScoreAnimation.tsx`, `TurnTimer.tsx`
    - Verify trivia components are NOT deleted: `TriviaQuestion.tsx`, `Leaderboard.tsx`, `NameEntryModal.tsx`, `NowPlayingHeader.tsx`, `PlayerScore.tsx`
    - _Requirements: 4.1, 4.2_

- [x] 7. Checkpoint — Verify deletions

  - Ensure all tests pass, ask the user if questions arise.
  - Run `yarn build` to confirm no import resolution errors after deletion

- [x] 8. Phase 5: Final verification

  - [x] 8.1 Run `yarn build` and confirm zero errors

    - _Requirements: 8.1_

  - [x] 8.2 Run `yarn lint:check` and confirm no new lint errors

    - _Requirements: 8.2_

  - [x] 8.3 Write property test: all DGS files are deleted

    - **Property 1: All DGS files are deleted**
    - Generate the full DGS deletion manifest (18 engine files, 7 hooks, 9 UI components, all `app/api/game/` routes, all `services/game/__tests__/` test files) and assert none exist on disk
    - **Validates: Requirements 1.1, 1.2, 2.1, 3.1, 4.1, 5.1**

  - [x] 8.4 Write property test: all preserved files are retained
    - **Property 2: All preserved files are retained**
    - Generate the full preservation manifest (`genreBackfill.ts`, `metadataBackfill.ts`, `genreConstants.ts`, `genreSimilarity.ts`, all `hooks/trivia/` files, all `app/api/trivia/` files, trivia UI components) and assert all exist on disk
    - **Validates: Requirements 2.2, 3.2, 4.2, 6.1, 6.2, 6.3**

- [x] 9. Final checkpoint — All verification complete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The phased approach ensures no dangling imports at any intermediate step
- Each phase builds on the previous: extract → rewire → clean → delete → verify
- Property tests validate the three correctness properties from the design document
- `gameService.ts` is retained since it has no DGS imports and is used by `musicService.ts`
- `genreSimilarity.ts` is preserved and rewired to use `artistCache.ts`
