/**
 * Property Test — Game Code Cleanup: All Preserved Files Are Retained
 *
 * **Feature: game-code-cleanup, Property 2: All preserved files are retained**
 * **Validates: Requirements 2.2, 3.2, 4.2, 6.1, 6.2, 6.3**
 *
 * Generates the full preservation manifest and asserts every file exists
 * on disk after cleanup. Covers shared utilities, new extracted modules,
 * trivia hooks, trivia API routes, and trivia UI components.
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

// ─── Shared Utilities (services/game/) ──────────────────────────────────────
// Requirement 6.1, 6.2, 6.3

const SHARED_UTILITIES = [
  'services/game/genreSimilarity.ts'
] as const

// ─── New Extracted Modules ──────────────────────────────────────────────────
// Requirement 6.1, 6.2

const EXTRACTED_MODULES = [
  'services/game/artistCache.ts',
  'shared/apiCallCategorizer.ts'
] as const

// ─── Trivia Hooks (hooks/trivia/) ───────────────────────────────────────────
// Requirement 3.2

const TRIVIA_HOOKS = [
  'hooks/trivia/session.ts',
  'hooks/trivia/useTriviaGame.ts',
  'hooks/trivia/useTriviaLeaderboard.ts',
  'hooks/trivia/__tests__/session.test.ts'
] as const

// ─── Trivia API Routes (app/api/trivia/) ────────────────────────────────────
// Requirement 2.2

const TRIVIA_API_ROUTES = [
  'app/api/trivia/route.ts',
  'app/api/trivia/__tests__/route.test.ts',
  'app/api/trivia/reset/route.ts',
  'app/api/trivia/reset/__tests__/route.test.ts',
  'app/api/trivia/scores/route.ts',
  'app/api/trivia/scores/__tests__/route.test.ts'
] as const

// ─── Trivia UI Components (app/[username]/game/components/) ─────────────────
// Requirement 4.2

const TRIVIA_UI_COMPONENTS = [
  'app/[username]/game/components/TriviaQuestion.tsx',
  'app/[username]/game/components/Leaderboard.tsx',
  'app/[username]/game/components/NameEntryModal.tsx',
  'app/[username]/game/components/NowPlayingHeader.tsx',
  'app/[username]/game/components/PlayerScore.tsx'
] as const

// ─── Combined full preservation manifest ────────────────────────────────────

const FULL_PRESERVATION_MANIFEST = [
  ...SHARED_UTILITIES,
  ...EXTRACTED_MODULES,
  ...TRIVIA_HOOKS,
  ...TRIVIA_API_ROUTES,
  ...TRIVIA_UI_COMPONENTS
] as const

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe('Property 2: All preserved files are retained', () => {
  /**
   * **Validates: Requirements 2.2, 3.2, 4.2, 6.1, 6.2, 6.3**
   *
   * For every file path in the full preservation manifest, that file
   * must exist on disk after cleanup.
   */
  it('every file from the preservation manifest exists on disk', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...FULL_PRESERVATION_MANIFEST),
        (filePath) => {
          const fullPath = path.join(ROOT, filePath)
          assert.ok(
            fs.existsSync(fullPath),
            `Preserved file must exist but is missing: ${filePath}`
          )
        }
      ),
      { numRuns: 200 }
    )
  })
})
