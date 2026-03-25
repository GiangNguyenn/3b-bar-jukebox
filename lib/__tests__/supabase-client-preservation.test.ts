import { describe, it } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../..')

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(root, relativePath), 'utf-8')
}

describe('Preservation: Existing client configuration and behavior preserved', () => {
  it('lib/supabase-admin.ts exports a client with autoRefreshToken: false and persistSession: false', () => {
    const src = readSource('lib/supabase-admin.ts')
    assert.ok(
      src.includes('autoRefreshToken: false'),
      'Expected autoRefreshToken: false in supabase-admin.ts'
    )
    assert.ok(
      src.includes('persistSession: false'),
      'Expected persistSession: false in supabase-admin.ts'
    )
  })

  it('services/stripeService.ts uses service-role-level access for database operations', () => {
    const src = readSource('services/stripeService.ts')
    // On unfixed code: uses SUPABASE_SERVICE_ROLE_KEY env var directly
    // On fixed code: imports supabaseAdmin from lib/supabase-admin (which uses service role key)
    const usesServiceRoleKeyDirectly = src.includes('SUPABASE_SERVICE_ROLE_KEY')
    const importsAdminSingleton =
      /import\s+\{[^}]*supabaseAdmin[^}]*\}\s+from\s+['"]@\/lib\/supabase-admin['"]/.test(src)
    assert.ok(
      usesServiceRoleKeyDirectly || importsAdminSingleton,
      'Expected stripeService to use service role key (directly or via supabase-admin import)'
    )
  })

  it('hooks/usePremiumStatus.ts does not call createBrowserClient', () => {
    const src = readSource('hooks/usePremiumStatus.ts')
    // The import may exist (unfixed) or be removed (fixed), but the function
    // body should never CALL createBrowserClient(). Match actual invocations
    // by looking for createBrowserClient( that is NOT part of an import statement.
    const lines = src.split('\n')
    const callLines = lines.filter(
      (line) =>
        line.includes('createBrowserClient(') &&
        !line.trimStart().startsWith('import')
    )
    assert.strictEqual(
      callLines.length,
      0,
      'Expected usePremiumStatus.ts to never call createBrowserClient()'
    )
  })

  it('services/game/dgsCache.ts retains anon client import from lib/supabase for reads', () => {
    const src = readSource('services/game/dgsCache.ts')
    // dgsCache should always import supabase from lib/supabase for read operations
    // This is true both before and after the fix
    const importsAnonClient =
      /import\s+\{[^}]*supabase[^}]*\}\s+from\s+['"]@\/lib\/supabase['"]/.test(src)
    assert.ok(
      importsAnonClient,
      'Expected dgsCache.ts to import supabase from @/lib/supabase for read operations'
    )
  })

  it('server-side service files use same URL and anon key for queries (singleton or inline)', () => {
    // Preservation property: all server-side services connect to the same
    // Supabase instance (same URL + same key). On unfixed code they use
    // createClient with NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.
    // On fixed code they import the singleton from lib/supabase which uses
    // the same env vars. Either way, query results are identical.
    const files = [
      'services/subscriptionService.ts',
      'services/subscriptionCache.ts',
      'utils/subscriptionQueries.ts',
      'services/game/metadataBackfill.ts'
    ]

    for (const file of files) {
      const src = readSource(file)
      const usesSingletonImport =
        /import\s+\{[^}]*supabase[^}]*\}\s+from\s+['"]@\/lib\/supabase['"]/.test(src)
      const usesCorrectEnvVars =
        src.includes('NEXT_PUBLIC_SUPABASE_URL') &&
        src.includes('NEXT_PUBLIC_SUPABASE_ANON_KEY')

      assert.ok(
        usesSingletonImport || usesCorrectEnvVars,
        `Expected ${file} to use the anon-key Supabase client (via singleton import or matching env vars)`
      )
    }
  })
})
