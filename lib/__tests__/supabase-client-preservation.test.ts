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
})
