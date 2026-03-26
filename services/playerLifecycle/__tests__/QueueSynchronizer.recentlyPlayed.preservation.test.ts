/**
 * Preservation Property Tests — Recently Played Tracking Fix
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
 *
 * These tests MUST PASS on unfixed code. They capture baseline behavior
 * that must remain unchanged after the fix is applied:
 *
 * Property 2: Preservation — Track Transition Behavior Unchanged
 *
 * Observation-first methodology: each test observes the current (unfixed) behavior
 * and asserts it, so we can detect regressions after the fix.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import type { JukeboxQueueItem } from '@/shared/types/queue'
import type { PlayerSDKState } from '../types'

// ─── Import real modules (no aiSuggestion interception needed for preservation) ─
const { QueueSynchronizer } =
  require('../QueueSynchronizer') as typeof import('../QueueSynchronizer')
const { playbackService } =
  require('@/services/player') as typeof import('@/services/player')
const { queueManager } =
  require('@/services/queueManager') as typeof import('@/services/queueManager')
const { DJService } =
  require('@/services/djService') as typeof import('@/services/djService')

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

function makeQueueItem(
  spotifyTrackId: string,
  name: string,
  profileId: string = 'profile-1'
): JukeboxQueueItem {
  return {
    id: `queue-${spotifyTrackId}`,
    profile_id: profileId,
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

/**
 * Creates a PlayerSDKState pair representing a track that has just finished.
 * isTrackFinished() returns true when:
 * - lastKnownState was playing, near end of track
 * - finishedState is paused, position reset to 0
 */
function makeFinishedState(
  trackId: string,
  trackName: string,
  artistName: string = 'Test Artist'
): { lastKnownState: PlayerSDKState; finishedState: PlayerSDKState } {
  const trackBase = {
    id: trackId,
    uri: `spotify:track:${trackId}`,
    name: trackName,
    artists: [{ name: artistName }],
    album: { name: 'Test Album', images: [] },
    duration_ms: 200000
  }

  const lastKnownState: PlayerSDKState = {
    paused: false,
    position: 195000,
    duration: 200000,
    track_window: { current_track: trackBase }
  }

  const finishedState: PlayerSDKState = {
    paused: true,
    position: 0,
    duration: 200000,
    track_window: { current_track: trackBase }
  }

  return { lastKnownState, finishedState }
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
    'Dreams',
    'Echoes',
    'Waves'
  ]
  const s1 = (seed * 1103515245 + 12345) & 0x7fffffff
  const s2 = (s1 * 1103515245 + 12345) & 0x7fffffff
  return `${prefixes[s1 % prefixes.length]} ${suffixes[s2 % suffixes.length]}`
}

function randomArtistName(seed: number): string {
  const names = [
    'The Rockers',
    'DJ Smooth',
    'Luna',
    'Neon Pulse',
    'Echo Chamber',
    'Velvet'
  ]
  const s = (seed * 1103515245 + 12345) & 0x7fffffff
  return names[s % names.length]
}

function randomProfileId(seed: number): string {
  return `profile-${randomString(8, seed)}`
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

describe('Preservation: Track Transition Behavior Unchanged', () => {
  /**
   * Test case 1: Queue removal
   *
   * **Validates: Requirements 3.1**
   *
   * Observation on UNFIXED code: when a track finishes naturally,
   * markFinishedTrackAsPlayed() is called with the correct currentSpotifyTrackId
   * and currentTrackName, removing the track from the queue.
   *
   * Property: For any track that finishes naturally with a matching queue item,
   * markFinishedTrackAsPlayed is called with the correct track ID and name.
   */
  describe('Queue Removal — markFinishedTrackAsPlayed called correctly', () => {
    it('should call markFinishedTrackAsPlayed with correct trackId and trackName for varied inputs', async () => {
      for (let seed = 1; seed <= 15; seed++) {
        const controller = makeRecordingController()
        const synchronizer = new QueueSynchronizer(controller)

        const trackId = randomTrackId(seed)
        const trackName = randomTrackName(seed)
        const artistName = randomArtistName(seed)
        const profileId = randomProfileId(seed)

        const queueItem = makeQueueItem(trackId, trackName, profileId)
        const nextItem = makeQueueItem(
          randomTrackId(seed + 1000),
          'Next Song',
          profileId
        )
        queueManager.updateQueue([queueItem, nextItem])
        queueManager.setCurrentlyPlayingTrack(trackId)

        const { lastKnownState, finishedState } = makeFinishedState(
          trackId,
          trackName,
          artistName
        )

        synchronizer.setLastKnownState(lastKnownState)
        synchronizer.setCurrentQueueTrack(queueItem)

        const markPlayedSpy = mock.method(
          synchronizer,
          'markFinishedTrackAsPlayed'
        )
        const djInstance = DJService.getInstance()
        mock.method(djInstance, 'maybeAnnounce', async () => {})

        await synchronizer.handleTrackFinished(finishedState)
        await playbackService.waitForCompletion()

        assert.equal(
          markPlayedSpy.mock.callCount(),
          1,
          `markFinishedTrackAsPlayed should be called once (seed=${seed})`
        )

        const callArgs = markPlayedSpy.mock.calls[0].arguments
        assert.equal(
          callArgs[0],
          trackId,
          `markFinishedTrackAsPlayed should receive correct trackId (seed=${seed})`
        )
        assert.equal(
          callArgs[1],
          trackName,
          `markFinishedTrackAsPlayed should receive correct trackName (seed=${seed})`
        )

        mock.restoreAll()
      }
    })
  })

  /**
   * Test case 2: Next track selection
   *
   * **Validates: Requirements 3.1**
   *
   * Observation on UNFIXED code: when a track finishes naturally,
   * findNextValidTrack is called and its result drives playNextTrackImpl.
   * The next track in the queue is played via the controller.
   *
   * Property: For any track finish with a next track in the queue,
   * the controller's playTrackWithRetry is called with the next track's URI.
   */
  describe('Next Track Selection — findNextValidTrack drives playNextTrackImpl', () => {
    it('should play the next track in queue after current track finishes for varied queue states', async () => {
      for (let seed = 1; seed <= 15; seed++) {
        const controller = makeRecordingController()
        const synchronizer = new QueueSynchronizer(controller)

        const currentId = randomTrackId(seed)
        const currentName = randomTrackName(seed)
        const nextId = randomTrackId(seed + 500)
        const nextName = randomTrackName(seed + 500)
        const profileId = randomProfileId(seed)

        const currentItem = makeQueueItem(currentId, currentName, profileId)
        const nextItem = makeQueueItem(nextId, nextName, profileId)

        // Some seeds get a third item to vary queue depth
        const items = [currentItem, nextItem]
        if (seed % 3 === 0) {
          items.push(
            makeQueueItem(randomTrackId(seed + 2000), 'Third Song', profileId)
          )
        }

        queueManager.updateQueue(items)
        queueManager.setCurrentlyPlayingTrack(currentId)

        const { lastKnownState, finishedState } = makeFinishedState(
          currentId,
          currentName,
          randomArtistName(seed)
        )

        synchronizer.setLastKnownState(lastKnownState)
        synchronizer.setCurrentQueueTrack(currentItem)

        const djInstance = DJService.getInstance()
        mock.method(djInstance, 'maybeAnnounce', async () => {})

        await synchronizer.handleTrackFinished(finishedState)
        await playbackService.waitForCompletion()

        const expectedUri = `spotify:track:${nextId}`
        assert.ok(
          controller.getPlayedTracks().includes(expectedUri),
          `Controller should play next track URI ${expectedUri} (seed=${seed}). ` +
            `Played: [${controller.getPlayedTracks().join(', ')}]`
        )

        mock.restoreAll()
      }
    })
  })

  /**
   * Test case 3: Duplicate detector early return
   *
   * **Validates: Requirements 3.4**
   *
   * Observation on UNFIXED code: when duplicateDetector.shouldProcessTrack()
   * returns false, handleTrackFinishedImpl returns early without calling
   * markFinishedTrackAsPlayed or starting playback.
   *
   * Property: For any track finish where shouldProcessTrack returns false,
   * no queue removal or playback calls occur.
   */
  describe('Duplicate Detector Early Return — no markFinishedTrackAsPlayed or playback', () => {
    it('should not call markFinishedTrackAsPlayed or play when shouldProcessTrack returns false', async () => {
      for (let seed = 1; seed <= 10; seed++) {
        const controller = makeRecordingController()
        const synchronizer = new QueueSynchronizer(controller)

        const trackId = randomTrackId(seed)
        const trackName = randomTrackName(seed)
        const profileId = randomProfileId(seed)

        const queueItem = makeQueueItem(trackId, trackName, profileId)
        const nextItem = makeQueueItem(
          randomTrackId(seed + 1000),
          'Next Song',
          profileId
        )
        queueManager.updateQueue([queueItem, nextItem])
        queueManager.setCurrentlyPlayingTrack(trackId)

        const { lastKnownState, finishedState } = makeFinishedState(
          trackId,
          trackName,
          randomArtistName(seed)
        )

        synchronizer.setLastKnownState(lastKnownState)
        synchronizer.setCurrentQueueTrack(queueItem)

        // Directly mock shouldProcessTrack to return false — simulating the
        // duplicate detector rejecting a track it has already processed
        const detector = synchronizer.getDuplicateDetector()
        mock.method(detector, 'shouldProcessTrack', () => false)

        const markPlayedSpy = mock.method(
          synchronizer,
          'markFinishedTrackAsPlayed'
        )
        const djInstance = DJService.getInstance()
        mock.method(djInstance, 'maybeAnnounce', async () => {})

        const playedBefore = controller.getPlayedTracks().length

        await synchronizer.handleTrackFinished(finishedState)
        await playbackService.waitForCompletion()

        assert.equal(
          markPlayedSpy.mock.callCount(),
          0,
          `markFinishedTrackAsPlayed should NOT be called when duplicate detector rejects (seed=${seed})`
        )

        assert.equal(
          controller.getPlayedTracks().length,
          playedBefore,
          `No new tracks should be played when duplicate detector rejects (seed=${seed})`
        )

        mock.restoreAll()
      }
    })
  })

  /**
   * Test case 4: DJ announce
   *
   * **Validates: Requirements 3.2**
   *
   * Observation on UNFIXED code: DJService.maybeAnnounce() is called with
   * the next track after findNextValidTrack resolves and before playNextTrackImpl.
   *
   * Property: For any track finish with a next track available,
   * maybeAnnounce is called with the next track item.
   */
  describe('DJ Announce — maybeAnnounce called with next track', () => {
    it('should call DJService.maybeAnnounce with the next track for varied inputs', async () => {
      for (let seed = 1; seed <= 15; seed++) {
        const controller = makeRecordingController()
        const synchronizer = new QueueSynchronizer(controller)

        const currentId = randomTrackId(seed)
        const currentName = randomTrackName(seed)
        const nextId = randomTrackId(seed + 500)
        const nextName = randomTrackName(seed + 500)
        const profileId = randomProfileId(seed)

        const currentItem = makeQueueItem(currentId, currentName, profileId)
        const nextItem = makeQueueItem(nextId, nextName, profileId)
        queueManager.updateQueue([currentItem, nextItem])
        queueManager.setCurrentlyPlayingTrack(currentId)

        const { lastKnownState, finishedState } = makeFinishedState(
          currentId,
          currentName,
          randomArtistName(seed)
        )

        synchronizer.setLastKnownState(lastKnownState)
        synchronizer.setCurrentQueueTrack(currentItem)

        const djInstance = DJService.getInstance()
        const announceSpy = mock.method(
          djInstance,
          'maybeAnnounce',
          async () => {}
        )

        await synchronizer.handleTrackFinished(finishedState)
        await playbackService.waitForCompletion()

        assert.equal(
          announceSpy.mock.callCount(),
          1,
          `maybeAnnounce should be called once (seed=${seed})`
        )

        const announceArg = announceSpy.mock.calls[0]
          .arguments[0] as JukeboxQueueItem
        assert.equal(
          announceArg.tracks.spotify_track_id,
          nextId,
          `maybeAnnounce should receive the next track (seed=${seed})`
        )

        mock.restoreAll()
      }
    })
  })
})
