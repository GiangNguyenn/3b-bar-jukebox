import { describe, it } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../..')

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(root, relativePath), 'utf-8')
}

void describe('Preservation: Existing client configuration and behavior preserved', () => {
  void it('lib/supabase-admin.ts exports a client with autoRefreshToken: false and persistSession: false', () => {
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

  void it('services/stripeService.ts uses service-role-level access for database operations', () => {
    const src = readSource('services/stripeService.ts')
    const usesServiceRoleKeyDirectly = src.includes('SUPABASE_SERVICE_ROLE_KEY')
    const importsAdminSingleton =
      /import\s+\{[^}]*supabaseAdmin[^}]*\}\s+from\s+['"]@\/lib\/supabase-admin['"]/.test(
        src
      )
    assert.ok(
      usesServiceRoleKeyDirectly || importsAdminSingleton,
      'Expected stripeService to use service role key (directly or via supabase-admin import)'
    )
  })

  void it('hooks/usePremiumStatus.ts does not call createBrowserClient', () => {
    const src = readSource('hooks/usePremiumStatus.ts')
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

  void it('services/game/dgsCache.ts retains anon client import from lib/supabase for reads', () => {
    const src = readSource('services/game/dgsCache.ts')
    const importsAnonClient =
      /import\s+\{[^}]*supabase[^}]*\}\s+from\s+['"]@\/lib\/supabase['"]/.test(
        src
      )
    assert.ok(
      importsAnonClient,
      'Expected dgsCache.ts to import supabase from @/lib/supabase for read operations'
    )
  })

  void it('server-side service files use same URL and anon key for queries (singleton or inline)', () => {
    const files = [
      'services/subscriptionService.ts',
      'services/subscriptionCache.ts',
      'utils/subscriptionQueries.ts',
      'services/game/metadataBackfill.ts'
    ]

    for (const file of files) {
      const src = readSource(file)
      const usesSingletonImport =
        /import\s+\{[^}]*supabase[^}]*\}\s+from\s+['"]@\/lib\/supabase['"]/.test(
          src
        )
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
