/**
 * Preservation Property Tests — Song Restart Loop Fix
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
 *
 * These tests MUST PASS on unfixed code. They capture baseline behavior
 * that must remain unchanged after the fix is applied:
 *
 * Property 2: Preservation — Exact Match, Empty Queue, and Genuine Mismatch Behavior
 *
 * Observation-first methodology: each test observes the current (unfixed) behavior
 * and asserts it, so we can detect regressions after the fix.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { QueueSynchronizer } from '../QueueSynchronizer'
import { playbackService } from '@/services/player'
import { queueManager } from '@/services/queueManager'
import type { JukeboxQueueItem } from '@/shared/types/queue'
import type { PlayerSDKState } from '../types'

// ─── localStorage mock (not available in Node.js test environment) ───────────
const localStorageStore: Record<string, string> = {}
const localStorageMock = {
  getItem: (key: string) => localStorageStore[key] ?? null,
  setItem: (key: string, value: string) => {
    localStorageStore[key] = value
  },
  removeItem: (key: string) => {
    delete localStorageStore[key]
  },
  clear: () => {
    Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k])
  }
}
// @ts-ignore
global.localStorage = localStorageMock

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeQueueItem(spotifyTrackId: string, name: string): JukeboxQueueItem {
  return {
    id: `queue-${spotifyTrackId}`,
    profile_id: 'profile-1',
    track_id: spotifyTrackId,
    votes: 0,
    queued_at: new Date().toISOString(),
    tracks: {
      id: spotifyTrackId,
      spotify_track_id: spotifyTrackId,
      name,
      artist: 'Test Artist',
      album: 'Test Album',
      genre: 'Pop',
      created_at: new Date().toISOString(),
      popularity: 60,
      duration_ms: 180000,
      spotify_url: `https://open.spotify.com/track/${spotifyTrackId}`,
      release_year: 2023
    }
  }
}

function makePlayingState(
  trackId: string,
  trackName: string,
  paused = false
): PlayerSDKState {
  return {
    paused,
    position: 60000,
    duration: 200000,
    track_window: {
      current_track: {
        id: trackId,
        uri: `spotify:track:${trackId}`,
        name: trackName,
        artists: [{ name: 'Test Artist' }],
        album: { name: 'Test Album', images: [] },
        duration_ms: 200000
      }
    }
  }
}

function makeRecordingController() {
  const playedTracks: string[] = []
  return {
    playTrackWithRetry: async (trackUri: string) => {
      playedTracks.push(trackUri)
      return true
    },
    log: () => {},
    getDeviceId: () => 'device-1',
    getPlayedTracks: () => playedTracks
  }
}

/**
 * Simple pseudo-random string generator for property-based style testing.
 * Generates varied inputs to cover a wider range of cases than fixed examples.
 */
function randomString(length: number, seed: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  let s = seed
  for (let i = 0; i < length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    result += chars[s % chars.length]
  }
  return result
}

function randomTrackId(seed: number): string {
  return `track-${randomString(12, seed)}`
}

function randomTrackName(seed: number): string {
  const prefixes = [
    'Song',
    'Track',
    'Melody',
    'Beat',
    'Rhythm',
    'Tune',
    'Anthem',
    'Ballad'
  ]
  const suffixes = [
    'of Love',
    'in the Night',
    'Forever',
    'Rising',
    'Falling',
    'Dreams'
  ]
  const s1 = (seed * 1103515245 + 12345) & 0x7fffffff
  const s2 = (s1 * 1103515245 + 12345) & 0x7fffffff
  return `${prefixes[s1 % prefixes.length]} ${suffixes[s2 % suffixes.length]}`
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────

beforeEach(async () => {
  await playbackService.waitForCompletion()
  localStorage.setItem('djMode', 'false')
  queueManager.updateQueue([])
  queueManager.setCurrentlyPlayingTrack(null)
})

afterEach(async () => {
  await playbackService.waitForCompletion()
  localStorage.setItem('djMode', 'false')
  mock.restoreAll()
})

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('Preservation: Exact Match, Empty Queue, and Genuine Mismatch Behavior', () => {
  /**
   * **Validates: Requirements 3.2**
   *
   * Observation on UNFIXED code: when Spotify track ID exactly matches
   * a queue item, currentQueueTrack is updated and playNextTrack() is NOT called.
   *
   * Property: For any queue item where the Spotify track ID matches exactly,
   * the synchronizer updates its internal state without triggering playNextTrack.
   */
  describe('Exact ID Match — currentQueueTrack updated, no playNextTrack', () => {
    it('should update currentQueueTrack and not call playNextTrack for exact ID match', () => {
      const controller = makeRecordingController()
      const synchronizer = new QueueSynchronizer(controller)

      const trackId = 'exact-match-id'
      const queueItem = makeQueueItem(trackId, 'Test Song')
      queueManager.updateQueue([queueItem])

      const sdkState = makePlayingState(trackId, 'Test Song')
      const playNextTrackSpy = mock.method(synchronizer, 'playNextTrack')

      synchronizer.syncQueueWithPlayback(sdkState)

      assert.equal(
        playNextTrackSpy.mock.callCount(),
        0,
        'playNextTrack() should NOT be called when Spotify track ID exactly matches a queue item'
      )
      assert.equal(
        synchronizer.getCurrentQueueTrack()?.id,
        queueItem.id,
        'currentQueueTrack should be updated to the matching queue item'
      )
    })

    it('should handle exact ID match across varied random inputs', () => {
      for (let seed = 1; seed <= 20; seed++) {
        const controller = makeRecordingController()
        const synchronizer = new QueueSynchronizer(controller)

        const trackId = randomTrackId(seed)
        const trackName = randomTrackName(seed)
        const queueItem = makeQueueItem(trackId, trackName)
        queueManager.updateQueue([queueItem])
        queueManager.setCurrentlyPlayingTrack(null)

        const sdkState = makePlayingState(trackId, trackName)
        const playNextTrackSpy = mock.method(synchronizer, 'playNextTrack')

        synchronizer.syncQueueWithPlayback(sdkState)

        assert.equal(
          playNextTrackSpy.mock.callCount(),
          0,
          `playNextTrack() should NOT be called for exact ID match (seed=${seed}, id=${trackId})`
        )
        assert.equal(
          synchronizer.getCurrentQueueTrack()?.tracks.spotify_track_id,
          trackId,
          `currentQueueTrack should reference the matched item (seed=${seed})`
        )
      }
    })

    it('should match correct item when multiple items in queue', () => {
      for (let seed = 1; seed <= 10; seed++) {
        const controller = makeRecordingController()
        const synchronizer = new QueueSynchronizer(controller)

        // Build a queue with 3-5 items
        const queueSize = 3 + (seed % 3)
        const items: JukeboxQueueItem[] = []
        for (let i = 0; i < queueSize; i++) {
          items.push(
            makeQueueItem(
              randomTrackId(seed * 100 + i),
              randomTrackName(seed * 100 + i)
            )
          )
        }
        queueManager.updateQueue(items)
        queueManager.setCurrentlyPlayingTrack(null)

        // Pick a random item from the queue to be the "playing" track
        const targetIdx = seed % queueSize
        const targetItem = items[targetIdx]

        const sdkState = makePlayingState(
          targetItem.tracks.spotify_track_id,
          targetItem.tracks.name
        )
        const playNextTrackSpy = mock.method(synchronizer, 'playNextTrack')

        synchronizer.syncQueueWithPlayback(sdkState)

        assert.equal(
          playNextTrackSpy.mock.callCount(),
          0,
          `playNextTrack() should NOT be called for exact match in multi-item queue (seed=${seed})`
        )
        assert.equal(
          synchronizer.getCurrentQueueTrack()?.id,
          targetItem.id,
          `currentQueueTrack should be the matched item (seed=${seed})`
        )
      }
    })
  })

  /**
   * **Validates: Requirements 3.3**
   *
   * Observation on UNFIXED code: when queue is empty and playback is active,
   * setCurrentlyPlayingTrack(null) is called and playNextTrack() is NOT called.
   *
   * Note: Looking at the code path — when queue is empty and no matchingQueueItem,
   * the else branch checks `queue.length > 0` which is false, so it falls through
   * to `this.currentQueueTrack = null`. setCurrentlyPlayingTrack is called with
   * the spotify track id earlier (line: queueManager.setCurrentlyPlayingTrack(currentSpotifyTrack.id)).
   * But when paused OR no current track, setCurrentlyPlayingTrack(null) is called.
   *
   * For empty queue with active playback: the track is set via setCurrentlyPlayingTrack(id),
   * then no matchingQueueItem found, queue.length === 0, so currentQueueTrack is set to null.
   * playNextTrack is NOT called.
   */
  describe('Empty Queue — no playNextTrack, currentQueueTrack cleared', () => {
    it('should not call playNextTrack when queue is empty and playback is active', () => {
      const controller = makeRecordingController()
      const synchronizer = new QueueSynchronizer(controller)

      queueManager.updateQueue([])

      const sdkState = makePlayingState('some-track-id', 'Some Song')
      const playNextTrackSpy = mock.method(synchronizer, 'playNextTrack')

      synchronizer.syncQueueWithPlayback(sdkState)

      assert.equal(
        playNextTrackSpy.mock.callCount(),
        0,
        'playNextTrack() should NOT be called when queue is empty'
      )
      assert.equal(
        synchronizer.getCurrentQueueTrack(),
        null,
        'currentQueueTrack should be null when queue is empty'
      )
    })

    it('should handle empty queue across varied random track inputs', () => {
      for (let seed = 1; seed <= 15; seed++) {
        const controller = makeRecordingController()
        const synchronizer = new QueueSynchronizer(controller)

        queueManager.updateQueue([])
        queueManager.setCurrentlyPlayingTrack(null)

        const trackId = randomTrackId(seed)
        const trackName = randomTrackName(seed)
        const sdkState = makePlayingState(trackId, trackName)
        const playNextTrackSpy = mock.method(synchronizer, 'playNextTrack')

        synchronizer.syncQueueWithPlayback(sdkState)

        assert.equal(
          playNextTrackSpy.mock.callCount(),
          0,
          `playNextTrack() should NOT be called for empty queue (seed=${seed})`
        )
        assert.equal(
          synchronizer.getCurrentQueueTrack(),
          null,
          `currentQueueTrack should be null for empty queue (seed=${seed})`
        )
      }
    })
  })

  /**
   * **Validates: Requirements 3.6**
   *
   * Observation on UNFIXED code: when a completely different track is playing
   * (no ID match AND no name match at all), playNextTrack() IS called with
   * the expected track to enforce queue order.
   */
  describe('Genuine Mismatch — playNextTrack IS called to enforce queue', () => {
    it('should call playNextTrack when a completely different track is playing', async () => {
      const controller = makeRecordingController()
      const synchronizer = new QueueSynchronizer(controller)

      const queueItem = makeQueueItem('expected-track-id', 'Expected Song')
      queueManager.updateQueue([queueItem])
      synchronizer.setCurrentQueueTrack(queueItem)

      // SDK reports a completely different track (different ID AND different name)
      const sdkState = makePlayingState(
        'wrong-track-id',
        'Completely Different Song'
      )
      const playNextTrackSpy = mock.method(synchronizer, 'playNextTrack')

      synchronizer.syncQueueWithPlayback(sdkState)

      await new Promise((r) => setTimeout(r, 50))

      assert.equal(
        playNextTrackSpy.mock.callCount(),
        1,
        'playNextTrack() should be called once for a genuine mismatch'
      )

      // Verify it was called with the expected track
      const callArgs = playNextTrackSpy.mock.calls[0].arguments
      assert.equal(
        (callArgs[0] as JukeboxQueueItem).tracks.spotify_track_id,
        'expected-track-id',
        'playNextTrack() should be called with the expected queue track'
      )
    })

    it('should enforce queue order across varied random mismatched inputs', async () => {
      for (let seed = 1; seed <= 10; seed++) {
        const controller = makeRecordingController()
        const synchronizer = new QueueSynchronizer(controller)

        // Generate two completely different track names
        const expectedName = randomTrackName(seed)
        const wrongName = randomTrackName(seed + 1000)
        const expectedId = randomTrackId(seed)
        const wrongId = randomTrackId(seed + 1000)

        // Ensure names are actually different (they should be with different seeds)
        if (expectedName.toLowerCase() === wrongName.toLowerCase()) continue

        const queueItem = makeQueueItem(expectedId, expectedName)
        queueManager.updateQueue([queueItem])
        queueManager.setCurrentlyPlayingTrack(null)
        synchronizer.setCurrentQueueTrack(queueItem)

        const sdkState = makePlayingState(wrongId, wrongName)
        const playNextTrackSpy = mock.method(synchronizer, 'playNextTrack')

        synchronizer.syncQueueWithPlayback(sdkState)

        await playbackService.waitForCompletion()

        assert.equal(
          playNextTrackSpy.mock.callCount(),
          1,
          `playNextTrack() should be called for genuine mismatch (seed=${seed}, expected="${expectedName}", got="${wrongName}")`
        )
      }
    })

    it('should use first queue item as expected track when currentQueueTrack is null', async () => {
      const controller = makeRecordingController()
      const synchronizer = new QueueSynchronizer(controller)

      const firstItem = makeQueueItem('first-track-id', 'First Song')
      const secondItem = makeQueueItem('second-track-id', 'Second Song')
      queueManager.updateQueue([firstItem, secondItem])
      // Do NOT set currentQueueTrack — it defaults to null

      const sdkState = makePlayingState('wrong-track-id', 'Wrong Song')
      const playNextTrackSpy = mock.method(synchronizer, 'playNextTrack')

      synchronizer.syncQueueWithPlayback(sdkState)

      await new Promise((r) => setTimeout(r, 50))

      assert.equal(
        playNextTrackSpy.mock.callCount(),
        1,
        'playNextTrack() should be called for genuine mismatch with null currentQueueTrack'
      )

      const callArgs = playNextTrackSpy.mock.calls[0].arguments
      assert.equal(
        (callArgs[0] as JukeboxQueueItem).tracks.spotify_track_id,
        'first-track-id',
        'playNextTrack() should fall back to queue[0] when currentQueueTrack is null'
      )
    })
  })

  /**
   * **Validates: Requirements 3.1, 3.4, 3.5**
   *
   * Observation on UNFIXED code: when playback is paused,
   * setCurrentlyPlayingTrack(null) is called and no queue enforcement occurs.
   * The function returns early before reaching the queue matching logic.
   */
  describe('Paused State — setCurrentlyPlayingTrack(null), no queue enforcement', () => {
    it('should set currentlyPlayingTrack to null and not call playNextTrack when paused', () => {
      const controller = makeRecordingController()
      const synchronizer = new QueueSynchronizer(controller)

      const queueItem = makeQueueItem('track-id', 'Test Song')
      queueManager.updateQueue([queueItem])
      synchronizer.setCurrentQueueTrack(queueItem)

      const sdkState = makePlayingState(
        'different-track-id',
        'Different Song',
        true
      )
      const playNextTrackSpy = mock.method(synchronizer, 'playNextTrack')
      const setCurrentlyPlayingSpy = mock.method(
        queueManager,
        'setCurrentlyPlayingTrack'
      )

      synchronizer.syncQueueWithPlayback(sdkState)

      assert.equal(
        playNextTrackSpy.mock.callCount(),
        0,
        'playNextTrack() should NOT be called when playback is paused'
      )

      // Verify setCurrentlyPlayingTrack(null) was called
      const nullCalls = setCurrentlyPlayingSpy.mock.calls.filter(
        (call) => call.arguments[0] === null
      )
      assert.ok(
        nullCalls.length > 0,
        'setCurrentlyPlayingTrack(null) should be called when paused'
      )
    })

    it('should handle paused state across varied random inputs without queue enforcement', () => {
      for (let seed = 1; seed <= 15; seed++) {
        const controller = makeRecordingController()
        const synchronizer = new QueueSynchronizer(controller)

        // Build a queue with random items
        const queueSize = 1 + (seed % 4)
        const items: JukeboxQueueItem[] = []
        for (let i = 0; i < queueSize; i++) {
          items.push(
            makeQueueItem(
              randomTrackId(seed * 100 + i),
              randomTrackName(seed * 100 + i)
            )
          )
        }
        queueManager.updateQueue(items)
        queueManager.setCurrentlyPlayingTrack(null)
        synchronizer.setCurrentQueueTrack(items[0])

        // SDK reports a mismatched track but paused — should NOT trigger enforcement
        const sdkState = makePlayingState(
          randomTrackId(seed + 5000),
          randomTrackName(seed + 5000),
          true // paused
        )
        const playNextTrackSpy = mock.method(synchronizer, 'playNextTrack')

        synchronizer.syncQueueWithPlayback(sdkState)

        assert.equal(
          playNextTrackSpy.mock.callCount(),
          0,
          `playNextTrack() should NOT be called when paused, even with mismatched track (seed=${seed})`
        )
      }
    })
  })
})
