/**
 * Property Test — Game Code Cleanup: Preserved Files Retained
 *
 * **Feature: game-code-cleanup, Property 2: All preserved files are retained**
 * **Validates: Requirements 6.1, 6.4**
 *
 * Verifies that:
 * - services/game/artistCache.ts exists on disk and exports the expected
 *   functions (upsertArtistProfile, batchUpsertArtistProfiles,
 *   batchGetArtistProfilesWithCache) plus the CachedArtistProfile interface
 *   and ApiStatisticsTracker type re-export
 * - shared/apiCallCategorizer.ts exists on disk
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

// ─── Expected exports from artistCache.ts ───────────────────────────────────

const ARTIST_CACHE_EXPECTED_FUNCTIONS = [
  'upsertArtistProfile',
  'batchUpsertArtistProfiles',
  'batchGetArtistProfilesWithCache'
] as const

const ARTIST_CACHE_EXPECTED_TYPES = [
  'CachedArtistProfile',
  'ApiStatisticsTracker'
] as const

// ─── Files that must exist after Phase 1 extraction ─────────────────────────

const PHASE1_PRESERVED_FILES = [
  'services/game/artistCache.ts',
  'shared/apiCallCategorizer.ts'
] as const

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe('Property 2: Phase 1 preserved files are retained', () => {
  /**
   * **Validates: Requirements 6.1, 6.4**
   *
   * For every file in the Phase 1 extraction manifest, the file must
   * exist on disk.
   */
  it('all Phase 1 extracted files exist on disk', () => {
    fc.assert(
      fc.property(fc.constantFrom(...PHASE1_PRESERVED_FILES), (filePath) => {
        const fullPath = path.join(ROOT, filePath)
        assert.ok(
          fs.existsSync(fullPath),
          `Preserved file must exist: ${filePath}`
        )
      }),
      { numRuns: 100 }
    )
  })

  /**
   * **Validates: Requirements 6.4**
   *
   * For every expected function export, artistCache.ts source must
   * contain an `export async function <name>` declaration matching
   * the original dgsCache.ts signatures.
   */
  it('artistCache.ts exports all expected functions', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'services/game/artistCache.ts'),
      'utf-8'
    )

    fc.assert(
      fc.property(
        fc.constantFrom(...ARTIST_CACHE_EXPECTED_FUNCTIONS),
        (fnName) => {
          const pattern = new RegExp(
            `export\\s+async\\s+function\\s+${fnName}\\s*\\(`
          )
          assert.ok(
            pattern.test(source),
            `artistCache.ts must export async function "${fnName}"`
          )
        }
      ),
      { numRuns: 100 }
    )
  })

  /**
   * **Validates: Requirements 6.4**
   *
   * For every expected type/interface export, artistCache.ts source
   * must contain the corresponding export declaration.
   */
  it('artistCache.ts exports CachedArtistProfile interface and ApiStatisticsTracker type', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'services/game/artistCache.ts'),
      'utf-8'
    )

    fc.assert(
      fc.property(
        fc.constantFrom(...ARTIST_CACHE_EXPECTED_TYPES),
        (typeName) => {
          // Match either `export interface X`, `export type { X }`, or `export type X`
          const interfacePattern = new RegExp(
            `export\\s+interface\\s+${typeName}\\b`
          )
          const typePattern = new RegExp(
            `export\\s+type\\s+\\{?\\s*${typeName}\\b`
          )
          // Also match re-export: `export { X }` or `export type { X }`
          const reExportPattern = new RegExp(
            `export\\s+(?:type\\s+)?\\{[^}]*\\b${typeName}\\b[^}]*\\}`
          )

          const found =
            interfacePattern.test(source) ||
            typePattern.test(source) ||
            reExportPattern.test(source)

          assert.ok(
            found,
            `artistCache.ts must export type/interface "${typeName}"`
          )
        }
      ),
      { numRuns: 100 }
    )
  })

  /**
   * **Validates: Requirements 6.1**
   *
   * shared/apiCallCategorizer.ts must export the ApiStatisticsTracker
   * interface and categorizeApiCall function.
   */
  it('apiCallCategorizer.ts exports expected symbols', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'shared/apiCallCategorizer.ts'),
      'utf-8'
    )

    const expectedExports = [
      'ApiStatisticsTracker',
      'categorizeApiCall',
      'OperationType'
    ] as const

    fc.assert(
      fc.property(fc.constantFrom(...expectedExports), (symbolName) => {
        const exportPattern = new RegExp(
          `export\\s+(?:interface|type|function|async\\s+function)\\s+${symbolName}\\b`
        )
        assert.ok(
          exportPattern.test(source),
          `apiCallCategorizer.ts must export "${symbolName}"`
        )
      }),
      { numRuns: 100 }
    )
  })
})
