import test from 'node:test'
import assert from 'node:assert'
import { POST } from '../route'
import { NextRequest } from 'next/server'

void test('POST /api/trivia/scores', async (t) => {
  await t.test('Invalid Zod input returns 400 error', async () => {
    const req = new NextRequest('http://localhost/api/trivia/scores', {
      method: 'POST',
      body: JSON.stringify({
        profile_id: 'bad-uuid', // invalid schema input
        session_id: '123'
      })
    })

    const response = await POST(req)
    assert.strictEqual(response.status, 400)
  })

  await t.test('Missing player_name fails schema validation', async () => {
    const req = new NextRequest('http://localhost/api/trivia/scores', {
      method: 'POST',
      body: JSON.stringify({
        profile_id: '123e4567-e89b-12d3-a456-426614174000',
        session_id: '123'
      })
    })

    const response = await POST(req)
    assert.strictEqual(response.status, 400)

    const body = (await response.json()) as { issues: unknown[] }
    assert.ok(body.issues.length > 0)
  })
})
