import test from 'node:test'
import assert from 'node:assert'
import { POST } from '../route'
import { NextRequest } from 'next/server'

void test('POST /api/trivia/reset', async (t) => {
  await t.test('Invalid Zod input returns 400 error', async () => {
    const req = new NextRequest('http://localhost/api/trivia/reset', {
      method: 'POST',
      body: JSON.stringify({
        profile_id: 'bad-uuid' // invalid schema input
      })
    })

    const response = await POST(req)
    assert.strictEqual(response.status, 400)
    
    const body = await response.json() as { issues: unknown[] }
    assert.ok(body.issues.length > 0)
  })
})
