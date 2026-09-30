/**
 * Unit tests for the now_playing publisher.
 *
 * The display page shows whatever the now_playing row holds, so a write that
 * is lost or lands out of order leaves the display on the previous song. These
 * tests cover the guarantees that prevent that:
 * - a failed write is retried instead of being counted as published
 * - writes are sent one at a time, and the latest state wins
 * - a stale row is detected and repaired by verifyNowPlaying
 */

import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  nowPlayingTransport,
  publishNowPlaying,
  resetNowPlayingPublisher,
  verifyNowPlaying
} from '../nowPlayingPublisher'
import type { SpotifyPlaybackState } from '@/shared/types/spotify'

// ─── Helpers ────────────────────────────────────────────────────────────────

const PROFILE_ID = 'profile-1'

function playbackState(
  trackId: string,
  isPlaying = true
): SpotifyPlaybackState {
  return {
    item: {
      id: trackId,
      name: `Track ${trackId}`,
      uri: `spotify:track:${trackId}`,
      duration_ms: 180000,
      artists: [{ name: 'Artist' }],
      album: { name: 'Album', images: [{ url: `https://img/${trackId}` }] }
    },
    is_playing: isPlaying,
    progress_ms: 0,
    timestamp: Date.now(),
    context: { uri: '' },
    device: {
      id: 'device',
      is_active: true,
      is_private_session: false,
      is_restricted: false,
      name: 'Jukebox Player',
      type: 'Computer',
      volume_percent: 50
    }
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

void describe('nowPlayingPublisher', () => {
  const originalTransport = { ...nowPlayingTransport }
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout

  let written: Array<string | null>
  let scheduled: Array<{ callback: () => void; delay: number }>

  beforeEach(() => {
    written = []
    scheduled = []
    resetNowPlayingPublisher()

    nowPlayingTransport.write = (row) => {
      written.push(row.spotify_track_id)
      return Promise.resolve(null)
    }
    nowPlayingTransport.read = () => Promise.resolve(null)

    // Capture retry timers instead of waiting for them
    globalThis.setTimeout = ((callback: () => void, delay: number) => {
      scheduled.push({ callback, delay })
      return scheduled.length as unknown as ReturnType<typeof setTimeout>
    }) as typeof globalThis.setTimeout
    globalThis.clearTimeout = (() => {}) as typeof globalThis.clearTimeout
  })

  afterEach(() => {
    resetNowPlayingPublisher()
    Object.assign(nowPlayingTransport, originalTransport)
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
  })

  void test('skips a write when track and play state are unchanged', async () => {
    await publishNowPlaying(PROFILE_ID, playbackState('a'))
    await publishNowPlaying(PROFILE_ID, playbackState('a'))

    assert.deepEqual(written, ['a'])
  })

  void test('retries a failed write instead of treating it as published', async () => {
    let failNext = true
    nowPlayingTransport.write = (row) => {
      if (failNext) {
        failNext = false
        return Promise.resolve('Failed to fetch')
      }
      written.push(row.spotify_track_id)
      return Promise.resolve(null)
    }

    await publishNowPlaying(PROFILE_ID, playbackState('a'))
    assert.deepEqual(written, [])
    assert.equal(scheduled.length, 1, 'a retry should be scheduled')

    scheduled[0].callback()
    await new Promise((resolve) => setImmediate(resolve))

    assert.deepEqual(written, ['a'])
  })

  void test('the same state is written again after a failure', async () => {
    nowPlayingTransport.write = () => Promise.resolve('Failed to fetch')
    await publishNowPlaying(PROFILE_ID, playbackState('a'))

    nowPlayingTransport.write = (row) => {
      written.push(row.spotify_track_id)
      return Promise.resolve(null)
    }
    await publishNowPlaying(PROFILE_ID, playbackState('a'))

    assert.deepEqual(written, ['a'])
  })

  void test('sends one write at a time and finishes on the latest state', async () => {
    const first = deferred<string | null>()
    let inFlight = 0
    let maxInFlight = 0
    nowPlayingTransport.write = async (row) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      written.push(row.spotify_track_id)
      if (written.length === 1) await first.promise
      inFlight -= 1
      return null
    }

    const publishA = publishNowPlaying(PROFILE_ID, playbackState('a'))
    const publishB = publishNowPlaying(PROFILE_ID, playbackState('b'))
    const publishC = publishNowPlaying(PROFILE_ID, playbackState('c'))
    first.resolve(null)
    await Promise.all([publishA, publishB, publishC])

    assert.equal(maxInFlight, 1)
    assert.deepEqual(written, ['a', 'c'])
  })

  void test('verifyNowPlaying rewrites a row that holds a previous song', async () => {
    await publishNowPlaying(PROFILE_ID, playbackState('b'))
    nowPlayingTransport.read = () =>
      Promise.resolve({ trackId: 'a', isPlaying: true })

    await verifyNowPlaying()

    assert.deepEqual(written, ['b', 'b'])
  })

  void test('verifyNowPlaying writes nothing when the row is correct', async () => {
    await publishNowPlaying(PROFILE_ID, playbackState('b'))
    nowPlayingTransport.read = () =>
      Promise.resolve({ trackId: 'b', isPlaying: true })

    await verifyNowPlaying()

    assert.deepEqual(written, ['b'])
  })

  void test('verifyNowPlaying writes nothing when the read fails', async () => {
    await publishNowPlaying(PROFILE_ID, playbackState('b'))
    nowPlayingTransport.read = () => Promise.resolve(undefined)

    await verifyNowPlaying()

    assert.deepEqual(written, ['b'])
  })
})
