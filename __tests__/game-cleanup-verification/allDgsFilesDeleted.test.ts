/**
 * Property Test — Game Code Cleanup: All DGS Files Are Deleted
 *
 * **Feature: game-code-cleanup, Property 1: All DGS files are deleted**
 * **Validates: Requirements 1.1, 1.2, 2.1, 3.1, 4.1, 5.1**
 *
 * Generates the full DGS deletion manifest (19 engine files, 7 hooks,
 * 9 UI components, all app/api/game/ routes, all services/game/__tests__/
 * test files) and asserts none exist on disk.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..', '..')

// ─── DGS Engine Service Files (19 files in services/game/) ──────────────────
// Requirement 1.1

const DGS_ENGINE_FILES = [
  'services/game/dgsEngine.ts',
  'services/game/dgsScoring.ts',
  'services/game/dgsDiversity.ts',
  'services/game/dgsTypes.ts',
  'services/game/dgsDb.ts',
  'services/game/dgsCache.ts',
  'services/game/clientPipeline.ts',
  'services/game/artistGraph.ts',
  'services/game/prepCache.ts',
  'services/game/lazyUpdateQueue.ts',
  'services/game/selfHealing.ts',
  'services/game/debugUtils.ts',
  'services/game/noopLogger.ts',
  'services/game/apiStatisticsTracker.ts',
  'services/game/adminAuth.ts',
  'services/game/gameRules.ts',
  'services/game/genreGraph.ts',
  'services/game/relatedArtistsDb.ts',
  'services/game/trackBackfill.ts'
] as const

// ─── DGS React Hooks (7 files in hooks/game/) ──────────────────────────────
// Requirement 3.1

const DGS_HOOK_FILES = [
  'hooks/game/useMusicGame.ts',
  'hooks/game/useGameData.ts',
  'hooks/game/useGameRound.ts',
  'hooks/game/useGameTimer.ts',
  'hooks/game/useBackgroundUpdates.ts',
  'hooks/game/usePopularArtists.ts',
  'hooks/game/usePlayerNames.ts'
] as const

// ─── DGS UI Components (9 files in app/[username]/game/components/) ─────────
// Requirement 4.1

const DGS_UI_COMPONENTS = [
  'app/[username]/game/components/ArtistSelectionModal.tsx',
  'app/[username]/game/components/DgsDebugPanel.tsx',
  'app/[username]/game/components/GameBoard.tsx',
  'app/[username]/game/components/GameOptionNode.tsx',
  'app/[username]/game/components/GameOptionSkeleton.tsx',
  'app/[username]/game/components/LoadingProgressBar.tsx',
  'app/[username]/game/components/PlayerHud.tsx',
  'app/[username]/game/components/ScoreAnimation.tsx',
  'app/[username]/game/components/TurnTimer.tsx'
] as const

// ─── DGS API Routes (all route.ts files under app/api/game/) ────────────────
// Requirement 2.1

const DGS_API_ROUTES = [
  'app/api/game/artists/route.ts',
  'app/api/game/influence/route.ts',
  'app/api/game/init-round/route.ts',
  'app/api/game/lazy-update-tick/route.ts',
  'app/api/game/options/route.ts',
  'app/api/game/pipeline/stage1-artists/route.ts',
  'app/api/game/pipeline/stage2-score-artists/route.ts',
  'app/api/game/pipeline/stage3-fetch-tracks/route.ts',
  'app/api/game/prep-seed/route.ts'
] as const

// ─── DGS Test Files (all test files in services/game/__tests__/) ────────────
// Requirement 1.2

const DGS_TEST_FILES = [
  'services/game/__tests__/candidatePoolIntegration.test.ts',
  'services/game/__tests__/dgsEngine.test.ts',
  'services/game/__tests__/fetchRandomArtistsFromDb.test.ts',
  'services/game/__tests__/fetchTopTracksForArtists.test.ts',
  'services/game/__tests__/stage2ScoringMismatch.test.ts',
  'services/game/__tests__/targetFiltering.test.ts'
] as const

// ─── Combined full deletion manifest ────────────────────────────────────────

const FULL_DELETION_MANIFEST = [
  ...DGS_ENGINE_FILES,
  ...DGS_HOOK_FILES,
  ...DGS_UI_COMPONENTS,
  ...DGS_API_ROUTES,
  ...DGS_TEST_FILES
] as const

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe('Property 1: All DGS files are deleted', () => {
  /**
   * **Validates: Requirements 1.1, 1.2, 2.1, 3.1, 4.1, 5.1**
   *
   * For every file path in the full DGS deletion manifest, that file
   * must not exist on disk after cleanup.
   */
  it('no file from the DGS deletion manifest exists on disk', () => {
    fc.assert(
      fc.property(fc.constantFrom(...FULL_DELETION_MANIFEST), (filePath) => {
        const fullPath = path.join(ROOT, filePath)
        assert.ok(
          !fs.existsSync(fullPath),
          `DGS file must be deleted but still exists: ${filePath}`
        )
      }),
      { numRuns: 200 }
    )
  })
})
