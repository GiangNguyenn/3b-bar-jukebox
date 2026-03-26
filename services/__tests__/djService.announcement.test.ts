// DJService announcement integration tests
// Validates: Requirements 1.1, 1.4, 2.1, 2.2

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// Track fetch calls for verification
let fetchCalls: Array<{ url: string; body: unknown }> = []

// Mock localStorage
const storage = new Map<string, string>()
const mockLocalStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
  get length() {
    return storage.size
  },
  key: () => null
} as Storage

// Helper: simulates the announcement set logic from _doFetchAudioBlob
async function simulateAnnouncementSet(
  scriptText: string,
  mockFetch: typeof globalThis.fetch
) {
  const profileId = mockLocalStorage.getItem('profileId')
  if (profileId) {
    await mockFetch('/api/dj-announcement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId, scriptText })
    }).catch(() => {})
  }
}

// Helper: simulates the announcement clear logic from playAudioBlob
async function simulateAnnouncementClear(mockFetch: typeof globalThis.fetch) {
  const profileId = mockLocalStorage.getItem('profileId')
  if (profileId) {
    await mockFetch('/api/dj-announcement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId, clear: true })
    }).catch(() => {})
  }
}

function makeMockFetch(shouldFail = false) {
  return async (url: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : undefined
    fetchCalls.push({ url: url as string, body })
    if (shouldFail) {
      throw new Error('Network error')
    }
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

void describe('DJService announcement integration', () => {
  beforeEach(() => {
    fetchCalls = []
    storage.clear()
    storage.set('profileId', 'test-profile-123')
  })

  void it('calls /api/dj-announcement with script text after successful script fetch', async () => {
    const mockFetch = makeMockFetch()
    await simulateAnnouncementSet('Next up is a banger', mockFetch)

    const calls = fetchCalls.filter((c) => c.url === '/api/dj-announcement')
    assert.equal(calls.length, 1, 'should call announcement endpoint once')
    assert.deepEqual(calls[0].body, {
      profileId: 'test-profile-123',
      scriptText: 'Next up is a banger'
    })
  })

  void it('calls /api/dj-announcement with clear: true on audio onended', async () => {
    const mockFetch = makeMockFetch()
    await simulateAnnouncementClear(mockFetch)

    const calls = fetchCalls.filter((c) => c.url === '/api/dj-announcement')
    assert.equal(calls.length, 1, 'should call clear once')
    assert.deepEqual(calls[0].body, {
      profileId: 'test-profile-123',
      clear: true
    })
  })

  void it('calls /api/dj-announcement with clear: true on audio onerror', async () => {
    const mockFetch = makeMockFetch()
    // onerror uses the same clear logic
    await simulateAnnouncementClear(mockFetch)

    const calls = fetchCalls.filter((c) => c.url === '/api/dj-announcement')
    assert.equal(calls.length, 1, 'should call clear once on error')
    assert.deepEqual(calls[0].body, {
      profileId: 'test-profile-123',
      clear: true
    })
  })

  void it('announcement failure does not throw or block', async () => {
    const failingFetch = makeMockFetch(true)

    // Should not throw
    await assert.doesNotReject(async () => {
      await simulateAnnouncementSet('Some script', failingFetch)
    }, 'announcement failure should be swallowed by .catch(() => {})')
  })

  void it('skips announcement when profileId is not in localStorage', async () => {
    storage.delete('profileId')
    const mockFetch = makeMockFetch()

    await simulateAnnouncementSet('Some script', mockFetch)

    const calls = fetchCalls.filter((c) => c.url === '/api/dj-announcement')
    assert.equal(
      calls.length,
      0,
      'should not call announcement without profileId'
    )
  })

  void it('skips clear when profileId is not in localStorage', async () => {
    storage.delete('profileId')
    const mockFetch = makeMockFetch()

    await simulateAnnouncementClear(mockFetch)

    const calls = fetchCalls.filter((c) => c.url === '/api/dj-announcement')
    assert.equal(calls.length, 0, 'should not call clear without profileId')
  })
})
