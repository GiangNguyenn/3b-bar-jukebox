import test from 'node:test'
import assert from 'node:assert'
import { POST } from '../route'
import { NextRequest } from 'next/server'

// Mock everything natively
void test('POST /api/trivia', async (t) => {
  // It's tricky to mock Supabase and fetch in node:test, so we will stub out the process.env.VENICE_AI_API_KEY
  await t.test('Missing Venice API key returns 500 error', async () => {
    const original = process.env.VENICE_AI_API_KEY
    delete process.env.VENICE_AI_API_KEY

    const req = new NextRequest('http://localhost/api/trivia', {
      method: 'POST',
      body: JSON.stringify({
        profile_id: '123e4567-e89b-12d3-a456-426614174000',
        spotify_track_id: 'track1',
        track_name: 'test',
        artist_name: 'artist',
        album_name: 'album'
      })
    })

    const response = await POST(req)
    assert.strictEqual(response.status, 500)
    process.env.VENICE_AI_API_KEY = original
  })

  await t.test('Invalid Zod input returns 400 error', async () => {
    const original = process.env.VENICE_AI_API_KEY
    process.env.VENICE_AI_API_KEY = 'fake_key'
    const req = new NextRequest('http://localhost/api/trivia', {
      method: 'POST',
      body: JSON.stringify({
        profile_id: 'bad-uuid',
        spotify_track_id: 'track1',
      })
    })

    const response = await POST(req)
    assert.strictEqual(response.status, 400)
    process.env.VENICE_AI_API_KEY = original
  })
})
