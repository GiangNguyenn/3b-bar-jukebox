/**
 * Unit tests for the pure helpers behind the diagnostics instrumentation.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  describeRequest,
  failureLevel,
  formatConsoleArgs,
  isOutageFailure,
  percentile
} from '../helpers'

const ORIGIN = 'https://jukebox.beer'

void describe('describeRequest', () => {
  void it('strips the query string, which can carry tokens', () => {
    const request = describeRequest(
      'https://api.spotify.com/v1/me/player/play?device_id=abc&token=secret',
      { method: 'put' },
      ORIGIN
    )
    assert.deepEqual(request, {
      method: 'PUT',
      host: 'api.spotify.com',
      path: '/v1/me/player/play',
      sameOrigin: false
    })
  })

  void it('resolves relative URLs against the page origin', () => {
    const request = describeRequest('/api/playback?x=1', undefined, ORIGIN)
    assert.deepEqual(request, {
      method: 'GET',
      host: 'jukebox.beer',
      path: '/api/playback',
      sameOrigin: true
    })
  })

  void it('reads the URL and method from a Request object', () => {
    const request = describeRequest(
      new Request('https://api.spotify.com/v1/me', { method: 'DELETE' }),
      undefined,
      ORIGIN
    )
    assert.equal(request.method, 'DELETE')
    assert.equal(request.path, '/v1/me')
  })

  void it('accepts a URL object', () => {
    const request = describeRequest(
      new URL('https://abc.supabase.co/rest/v1/profiles?select=*'),
      undefined,
      ORIGIN
    )
    assert.equal(request.host, 'abc.supabase.co')
    assert.equal(request.path, '/rest/v1/profiles')
  })
})

void describe('failureLevel', () => {
  void it('warns on server errors, auth failures, timeouts and rate limits', () => {
    for (const status of [500, 503, 401, 408, 429]) {
      assert.equal(failureLevel(status), 'WARN')
    }
  })

  void it('keeps ordinary client errors quiet', () => {
    for (const status of [400, 403, 404]) {
      assert.equal(failureLevel(status), 'INFO')
    }
  })

  void it('warns when the request threw, unless it was aborted', () => {
    assert.equal(failureLevel(null, 'TypeError'), 'WARN')
    assert.equal(failureLevel(null, 'AbortError'), 'INFO')
  })
})

void describe('isOutageFailure', () => {
  void it('counts network errors and 5xx, not client errors or aborts', () => {
    assert.equal(isOutageFailure(null, 'TypeError'), true)
    assert.equal(isOutageFailure(502), true)
    assert.equal(isOutageFailure(429), false)
    assert.equal(isOutageFailure(null, 'AbortError'), false)
  })
})

void describe('formatConsoleArgs', () => {
  void it('extracts a leading [Context] tag', () => {
    const result = formatConsoleArgs([
      '[PlayerState] Invalid transition from ready to verifying'
    ])
    assert.equal(result.context, 'PlayerState')
    assert.equal(result.message, 'Invalid transition from ready to verifying')
  })

  void it('extracts a [Context] passed as its own argument', () => {
    const result = formatConsoleArgs(['[DeviceApi]', 'Transfer failed', 404])
    assert.equal(result.context, 'DeviceApi')
    assert.equal(result.message, 'Transfer failed 404')
  })

  void it('formats errors and objects and returns the error', () => {
    const error = new TypeError('Failed to fetch')
    const result = formatConsoleArgs(['Request failed:', error, { retry: 2 }])
    assert.equal(result.context, undefined)
    assert.equal(
      result.message,
      'Request failed: TypeError: Failed to fetch {"retry":2}'
    )
    assert.equal(result.error, error)
  })

  void it('survives values that cannot be serialised', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    assert.equal(formatConsoleArgs([circular]).message, '[object Object]')
  })
})

void describe('percentile', () => {
  void it('returns the value at the given fraction', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1)
    assert.equal(percentile(values, 0.95), 95)
    assert.equal(percentile(values, 0.5), 50)
  })

  void it('handles empty and single-value input', () => {
    assert.equal(percentile([], 0.95), 0)
    assert.equal(percentile([42], 0.95), 42)
  })
})
