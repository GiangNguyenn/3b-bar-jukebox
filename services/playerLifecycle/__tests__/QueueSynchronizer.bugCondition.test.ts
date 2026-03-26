/**
 * Bug Condition Exploration Test — Song Restart Loop
 *
 * **Validates: Requirements 1.1, 1.2, 2.1, 2.2**
 *
 * These tests are EXPECTED TO FAIL on unfixed code.
 * Failure confirms the bug exists: syncQueueWithPlayback() calls playNextTrack()
 * when track names differ only by parenthetical suffixes (feat., Remastered, etc.)
 * because the current toLowerCase() comparison is too strict.
 *
 * Property 1: Bug Condition — Fuzzy Name Mismatch Triggers Restart Loop
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

function makePlayingState(trackId: string, trackName: string): PlayerSDKState {
  return {
    paused: false,
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

/**
 * Creates a PlaybackController that records playTrackWithRetry calls.
 */
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

// ─── Setup / Teardown ────────────────────────────────────────────────────────

beforeEach(async () => {
  await playbackService.waitForCompletion()
  localStorage.setItem('djMode', 'false')
  // Reset queueManager state
  queueManager.updateQueue([])
  queueManager.setCurrentlyPlayingTrack(null)
})

afterEach(async () => {
  await playbackService.waitForCompletion()
  localStorage.setItem('djMode', 'false')
  mock.restoreAll()
})

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('Bug Condition: Fuzzy Name Mismatch Triggers Restart Loop', () => {
  /**
   * Test case 1: Featuring artist suffix
   *
   * SDK reports "Dirrty (feat. Redman)" with a relinked ID,
   * queue has "Dirrty". The track is the same song but the current
   * toLowerCase() comparison fails because the strings differ.
   *
   * Expected (correct behavior): playNextTrack() is NOT called
   * Actual (bug): playNextTrack() IS called, restarting the song
   */
  it('should NOT call playNextTrack when track name differs only by featuring suffix', async () => {
    const controller = makeRecordingController()
    const synchronizer = new QueueSynchronizer(controller)

    // Queue has "Dirrty" with queue-track-id
    const queueItem = makeQueueItem('queue-track-id', 'Dirrty')
    queueManager.updateQueue([queueItem])

    // Set the current queue track so syncQueueWithPlayback uses it as expectedTrack
    synchronizer.setCurrentQueueTrack(queueItem)

    // SDK reports a DIFFERENT Spotify ID (relinked) with "(feat. Redman)" suffix
    const sdkState = makePlayingState(
      'relinked-spotify-id',
      'Dirrty (feat. Redman)'
    )

    // Spy on playNextTrack to detect if it gets called
    const playNextTrackSpy = mock.method(synchronizer, 'playNextTrack')

    synchronizer.syncQueueWithPlayback(sdkState)

    // Allow any async playNextTrack calls to settle
    await new Promise((r) => setTimeout(r, 50))

    // EXPECTED: playNextTrack should NOT be called (same song, different metadata)
    // BUG: playNextTrack IS called because toLowerCase() comparison fails
    assert.equal(
      playNextTrackSpy.mock.callCount(),
      0,
      'playNextTrack() should NOT be called when track name differs only by "(feat. Redman)" suffix. ' +
        'Bug: the simple toLowerCase() comparison fails to match "Dirrty" with "Dirrty (feat. Redman)"'
    )
  })

  /**
   * Test case 2: Remastered suffix
   *
   * SDK reports "Bohemian Rhapsody - Remastered 2011",
   * queue has "Bohemian Rhapsody". Same song, different metadata.
   *
   * Expected (correct behavior): playNextTrack() is NOT called
   * Actual (bug): playNextTrack() IS called, restarting the song
   */
  it('should NOT call playNextTrack when track name differs only by remastered suffix', async () => {
    const controller = makeRecordingController()
    const synchronizer = new QueueSynchronizer(controller)

    const queueItem = makeQueueItem('queue-track-id', 'Bohemian Rhapsody')
    queueManager.updateQueue([queueItem])
    synchronizer.setCurrentQueueTrack(queueItem)

    // SDK reports relinked ID with "- Remastered 2011" suffix
    const sdkState = makePlayingState(
      'relinked-spotify-id',
      'Bohemian Rhapsody - Remastered 2011'
    )

    const playNextTrackSpy = mock.method(synchronizer, 'playNextTrack')

    synchronizer.syncQueueWithPlayback(sdkState)

    await new Promise((r) => setTimeout(r, 50))

    assert.equal(
      playNextTrackSpy.mock.callCount(),
      0,
      'playNextTrack() should NOT be called when track name differs only by "- Remastered 2011" suffix. ' +
        'Bug: the simple toLowerCase() comparison fails to match "Bohemian Rhapsody" with "Bohemian Rhapsody - Remastered 2011"'
    )
  })

  /**
   * Test case 3: Repeated force-play (restart loop)
   *
   * Call syncQueueWithPlayback() twice with the same mismatched state,
   * resetting queueManager state between calls to simulate the real loop
   * where each SDK state change event re-enters syncQueueWithPlayback.
   *
   * Expected (correct behavior): playNextTrack() called at most once
   * Actual (bug): playNextTrack() called twice (no guard)
   */
  it('should call playNextTrack at most once when syncQueueWithPlayback is called twice with same mismatch', async () => {
    const controller = makeRecordingController()
    const synchronizer = new QueueSynchronizer(controller)

    const queueItem = makeQueueItem('queue-track-id', 'Dirrty')

    // SDK reports relinked ID with featuring suffix — triggers the bug
    const sdkState = makePlayingState(
      'relinked-spotify-id',
      'Dirrty (feat. Redman)'
    )

    const playNextTrackSpy = mock.method(synchronizer, 'playNextTrack')

    // First SDK state change event
    queueManager.updateQueue([queueItem])
    queueManager.setCurrentlyPlayingTrack(null)
    synchronizer.setCurrentQueueTrack(queueItem)
    synchronizer.syncQueueWithPlayback(sdkState)

    // Wait for the first playNextTrack to complete through playbackService
    // so isOperationInProgress() returns false for the second call
    await playbackService.waitForCompletion()

    // Simulate the real loop: after playNextTrack restarts the track,
    // a new SDK state change fires. Reset queue state to match what
    // happens in production (queue still has the item, track is "playing")
    queueManager.updateQueue([queueItem])
    queueManager.setCurrentlyPlayingTrack(null)
    synchronizer.setCurrentQueueTrack(queueItem)

    // Second SDK state change event — same mismatch
    synchronizer.syncQueueWithPlayback(sdkState)

    await playbackService.waitForCompletion()

    // EXPECTED: playNextTrack called at most once (force-play guard)
    // BUG: playNextTrack called twice (no guard, each sync triggers a restart)
    assert.ok(
      playNextTrackSpy.mock.callCount() <= 1,
      `playNextTrack() should be called at most once for the same mismatched track, ` +
        `but was called ${playNextTrackSpy.mock.callCount()} times. ` +
        'Bug: no force-play guard prevents repeated playNextTrack() calls for the same track'
    )
  })
})
