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
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4
 */

const root = process.cwd()

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(root, relativePath), 'utf-8')
}

describe('Bug Condition: Duplicate browser clients (Req 1.1)', () => {
  const browserFiles = [
    'hooks/usePlaylistData.ts',
    'hooks/useTrackGenre.ts',
    'hooks/useGetProfile.tsx',
    'shared/utils/authCleanup.ts',
    'app/[username]/admin/components/branding/hooks/useBrandingSettings.ts',
    'app/[username]/admin/components/analytics/analytics-tab.tsx',
    'app/[username]/admin/components/analytics/popularity-histogram.tsx',
    'app/[username]/admin/components/analytics/release-year-histogram.tsx',
    'app/[username]/admin/components/ProtectedRoute.tsx',
    'app/page.tsx',
    'app/premium-required/page.tsx',
    'app/auth/signin/page.tsx'
  ]

  for (const file of browserFiles) {
    it(`${file} should NOT contain createBrowserClient calls`, () => {
      const content = readSource(file)
      // After fix, no file should import or call createBrowserClient
      // Check for import statement from @supabase/ssr
      const hasImport = /import\s+\{[^}]*createBrowserClient[^}]*\}\s+from\s+['"]@supabase\/ssr['"]/.test(content)
      assert.strictEqual(
        hasImport,
        false,
        `${file} should not import createBrowserClient from @supabase/ssr`
      )
    })
  }
})

describe('Bug Condition: Artist upsert client (Req 1.2)', () => {
  it('dgsCache.ts upsert functions should use supabaseAdmin from lib/supabase-admin', () => {
    const content = readSource('services/game/dgsCache.ts')
    assert.ok(
      content.includes("from '@/lib/supabase-admin'") ||
        content.includes('from "@/lib/supabase-admin"'),
      'dgsCache.ts should import from lib/supabase-admin'
    )
  })
})

describe('Bug Condition: Favicon existence (Req 1.3)', () => {
  it('public/favicon.ico should exist', () => {
    const faviconPath = path.resolve(root, 'public/favicon.ico')
    assert.ok(
      fs.existsSync(faviconPath),
      'public/favicon.ico does not exist'
    )
  })
})

describe('Bug Condition: Server-side singleton usage (Req 1.4)', () => {
  const serverSingletonFiles = [
    'services/subscriptionService.ts',
    'services/subscriptionCache.ts',
    'utils/subscriptionQueries.ts',
    'services/game/metadataBackfill.ts'
  ]

  for (const file of serverSingletonFiles) {
    it(`${file} should import from lib/supabase singleton, not createClient directly`, () => {
      const content = readSource(file)
      const hasDirectCreateClient =
        content.includes("from '@supabase/supabase-js'") ||
        content.includes('from "@supabase/supabase-js"')
      const hasSingletonImport =
        content.includes("from '@/lib/supabase'") ||
        content.includes('from "@/lib/supabase"')

      assert.ok(
        !hasDirectCreateClient,
        `${file} should not import createClient from @supabase/supabase-js`
      )
      assert.ok(
        hasSingletonImport,
        `${file} should import from @/lib/supabase`
      )
    })
  }

  it('stripeService.ts should import from lib/supabase-admin', () => {
    const content = readSource('services/stripeService.ts')
    const hasAdminImport =
      content.includes("from '@/lib/supabase-admin'") ||
      content.includes('from "@/lib/supabase-admin"')
    assert.ok(
      hasAdminImport,
      'stripeService.ts should import supabaseAdmin from @/lib/supabase-admin'
    )
  })
})
