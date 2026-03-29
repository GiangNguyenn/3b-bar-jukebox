/**
 * Property Test — Game Code Cleanup: No Surviving Source File Imports a Deleted Module
 *
 * **Feature: game-code-cleanup, Property 3: No surviving source file imports a deleted module**
 * **Validates: Requirements 5.2, 7.1, 7.3**
 *
 * Parses all .ts/.tsx files remaining after cleanup and asserts none contain
 * import paths referencing any of the deleted DGS module names.
 *
 * Files on the DGS deletion manifest are excluded from the scan since they
 * still exist at this point (Phase 4 deletes them later). Test files in
 * __tests__/game-cleanup-verification/ and services/game/__tests__/ are also
 * excluded since they may reference DGS module names in string literals.
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

// ─── Deleted DGS module names ───────────────────────────────────────────────

const DELETED_DGS_MODULES = [
  'dgsCache',
  'dgsDb',
  'dgsTypes',
  'artistGraph',
  'apiStatisticsTracker',
  'dgsEngine',
  'dgsScoring',
  'dgsDiversity',
  'clientPipeline',
  'prepCache',
  'lazyUpdateQueue',
  'selfHealing',
  'debugUtils',
  'noopLogger',
  'adminAuth',
  'gameRules',
  'genreGraph',
  'relatedArtistsDb',
  'trackBackfill'
] as const

// ─── Full DGS deletion manifest (files that still exist but will be deleted) ─

const DGS_DELETION_MANIFEST = new Set([
  // 18 DGS engine services
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
  'services/game/trackBackfill.ts',
  // 9 DGS UI components
  'app/[username]/game/components/ArtistSelectionModal.tsx',
  'app/[username]/game/components/DgsDebugPanel.tsx',
  'app/[username]/game/components/GameBoard.tsx',
  'app/[username]/game/components/GameOptionNode.tsx',
  'app/[username]/game/components/GameOptionSkeleton.tsx',
  'app/[username]/game/components/LoadingProgressBar.tsx',
  'app/[username]/game/components/PlayerHud.tsx',
  'app/[username]/game/components/ScoreAnimation.tsx',
  'app/[username]/game/components/TurnTimer.tsx'
])

// ─── Directories to skip during recursive scan ─────────────────────────────

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  '.kiro',
  'dist',
  'out'
])

// ─── Relative path prefixes to exclude from scan ────────────────────────────
// Test dirs that reference DGS names in string literals, plus entire DGS
// directories that will be deleted in Phase 4.

const EXCLUDED_PATH_PREFIXES = [
  '__tests__/game-cleanup-verification/',
  'services/game/__tests__/',
  'hooks/game/',
  'app/api/game/'
]

// ─── Helpers ────────────────────────────────────────────────────────────────

function collectTsFiles(dir: string, rootDir: string): string[] {
  const results: string[] = []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return results
  }

  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue

    const fullPath = path.join(dir, entry.name)
    const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/')

    if (entry.isDirectory()) {
      results.push(...collectTsFiles(fullPath, rootDir))
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
    ) {
      // Skip files on the DGS deletion manifest
      if (DGS_DELETION_MANIFEST.has(relPath)) continue

      // Skip excluded path prefixes
      const inExcludedPrefix = EXCLUDED_PATH_PREFIXES.some((prefix) =>
        relPath.startsWith(prefix)
      )
      if (inExcludedPrefix) continue

      results.push(relPath)
    }
  }

  return results
}

/**
 * Regex that matches ES import/export-from statements referencing a specific
 * module name as the final path segment. Handles:
 *   import { x } from './game/dgsCache'
 *   import type { X } from '@/services/game/dgsCache'
 *   import * as foo from '../dgsCache'
 *   export { x } from './dgsCache'
 *   import('./dgsCache')
 */
function buildImportPattern(moduleName: string): RegExp {
  return new RegExp(
    `(?:from\\s+['"\`][^'"\`]*[/.]${moduleName}['"\`])|(?:import\\s*\\(\\s*['"\`][^'"\`]*[/.]${moduleName}['"\`]\\s*\\))`,
    'g'
  )
}

// ─── Collect all surviving source files once ────────────────────────────────

const survivingFiles = collectTsFiles(ROOT, ROOT)

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe('Property 3: No surviving source file imports a deleted module', () => {
  /**
   * **Validates: Requirements 5.2, 7.1, 7.3**
   *
   * For every (surviving file, deleted module name) pair, the file's
   * content must not contain an import statement referencing that module.
   */
  it('no surviving .ts/.tsx file imports any deleted DGS module', () => {
    // Build a map of file contents for efficiency
    const fileContents = new Map<string, string>()
    for (const relPath of survivingFiles) {
      const content = fs.readFileSync(path.join(ROOT, relPath), 'utf-8')
      fileContents.set(relPath, content)
    }

    fc.assert(
      fc.property(
        fc.constantFrom(...survivingFiles),
        fc.constantFrom(...DELETED_DGS_MODULES),
        (filePath, moduleName) => {
          const content = fileContents.get(filePath)!
          const pattern = buildImportPattern(moduleName)
          const match = pattern.exec(content)
          assert.equal(
            match,
            null,
            `File "${filePath}" imports deleted DGS module "${moduleName}": ${match?.[0]}`
          )
        }
      ),
      { numRuns: 1000 }
    )
  })
})
