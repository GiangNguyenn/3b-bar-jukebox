/**
 * Property Test — Game Code Cleanup: All Preserved Files Are Retained
 *
 * **Feature: game-code-cleanup, Property 2: All preserved files are retained**
 * **Validates: Requirements 6.1, 6.2, 6.3**
 *
 * Generates the preservation manifest and asserts every file exists on disk.
 * Covers shared utilities and new extracted modules.
 * Note: trivia files were removed as part of the trivia feature removal.
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

const SHARED_UTILITIES = ['services/game/genreSimilarity.ts'] as const

// ─── New Extracted Modules ──────────────────────────────────────────────────
// Requirement 6.1, 6.2

const EXTRACTED_MODULES = [
  'services/game/artistCache.ts',
  'shared/apiCallCategorizer.ts'
] as const

// ─── Combined full preservation manifest ────────────────────────────────────

const FULL_PRESERVATION_MANIFEST = [
  ...SHARED_UTILITIES,
  ...EXTRACTED_MODULES
] as const

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe('Property 2: All preserved files are retained', () => {
  /**
   * **Validates: Requirements 6.1, 6.2, 6.3**
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
