import { describe, it } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Bug Condition Exploration Tests
 *
 * These tests encode the EXPECTED (fixed) behavior. They are designed to
 * FAIL on unfixed code, proving the bugs exist. After the fix is applied,
 * these same tests will PASS.
 *
 * Validates: Requirements 1.1, 1.3, 1.4
 */

const root = process.cwd()

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(root, relativePath), 'utf-8')
}

void describe('Bug Condition: Duplicate browser clients (Req 1.1)', () => {
  const browserFiles = [
    'hooks/usePlaylistData.ts',
    'hooks/useTrackGenre.ts',
    'hooks/useGetProfile.tsx',
    'shared/utils/authCleanup.ts',
    'app/[username]/admin/components/analytics/analytics-tab.tsx',
    'app/[username]/admin/components/analytics/popularity-histogram.tsx',
    'app/[username]/admin/components/analytics/release-year-histogram.tsx',
    'app/[username]/admin/components/ProtectedRoute.tsx',
    'app/page.tsx',
    'app/premium-required/page.tsx',
    'app/auth/signin/page.tsx'
  ]

  for (const file of browserFiles) {
    void it(`${file} should NOT contain createBrowserClient calls`, () => {
      const content = readSource(file)
      const hasImport =
        /import\s+\{[^}]*createBrowserClient[^}]*\}\s+from\s+['"]@supabase\/ssr['"]/.test(
          content
        )
      assert.strictEqual(
        hasImport,
        false,
        `${file} should not import createBrowserClient from @supabase/ssr`
      )
    })
  }
})

void describe('Bug Condition: Favicon existence (Req 1.3)', () => {
  void it('public/favicon.ico should exist', () => {
    const faviconPath = path.resolve(root, 'public/favicon.ico')
    assert.ok(fs.existsSync(faviconPath), 'public/favicon.ico does not exist')
  })
})
