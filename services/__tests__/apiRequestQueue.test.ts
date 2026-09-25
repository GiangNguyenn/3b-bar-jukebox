/**
 * sendApiRequest runs every request through one global serial queue, so a
 * single stuck request used to stop all Spotify calls (and with them all
 * playback) until the page was reloaded. Mutations were also served from the
 * read-dedup cache, turning retries into replays of the first failure.
 */

import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { sendApiRequest } from '@/shared/api'

const realFetch = globalThis.fetch

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

void describe('sendApiRequest queue', () => {
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  void it('a request that never settles does not block the requests behind it', async () => {
    let calls = 0
    globalThis.fetch = (() => {
      calls++
      // First request hangs forever, ignoring its abort signal
      if (calls === 1) return new Promise<Response>(() => {})
      return Promise.resolve(jsonResponse(200, { ok: true }))
    }) as typeof fetch

    const hung = sendApiRequest({
      path: 'test/hung',
      token: 't',
      timeout: 50
    })
    const next = sendApiRequest<{ ok: boolean }>({
      path: 'test/next',
      token: 't',
      timeout: 2000
    })

    await assert.rejects(hung, /timed out/)
    assert.deepEqual(await next, { ok: true })
  })

  void it('retrying a failed mutation sends it again instead of replaying the cached failure', async () => {
    let calls = 0
    globalThis.fetch = (() => {
      calls++
      return Promise.resolve(
        calls === 1
          ? jsonResponse(404, { error: { message: 'Device not found' } })
          : jsonResponse(200, { ok: true })
      )
    }) as typeof fetch

    const request = {
      path: 'me/player/play?device_id=d1',
      method: 'PUT' as const,
      body: { uris: ['spotify:track:a'] },
      token: 't'
    }

    await assert.rejects(sendApiRequest(request), /Device not found/)
    assert.deepEqual(await sendApiRequest(request), { ok: true })
    assert.equal(calls, 2)
  })

  void it('still de-duplicates identical reads', async () => {
    let calls = 0
    globalThis.fetch = (() => {
      calls++
      return Promise.resolve(jsonResponse(200, { n: calls }))
    }) as typeof fetch

    const a = await sendApiRequest({ path: 'test/read-dedup', token: 't' })
    const b = await sendApiRequest({ path: 'test/read-dedup', token: 't' })

    assert.deepEqual(a, b)
    assert.equal(calls, 1)
  })
})
