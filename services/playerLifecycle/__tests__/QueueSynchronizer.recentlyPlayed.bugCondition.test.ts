/**
 * Bug Condition Exploration Test — Recently Played Tracking
 *
 * **Validates: Requirements 1.1, 2.1, 2.2**
 *
 * These tests are EXPECTED TO FAIL on unfixed code.
 * Failure confirms the bug exists: handleTrackFinishedImpl() never calls
 * addToRecentlyPlayed() when a track finishes naturally, so the
 * recently_played_tracks table is never populated from actual playback.
 *
 * Property 1: Bug Condition — Track Finish Does Not Record Recently Played
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import type { JukeboxQueueItem } from '@/shared/types/queue'
import type { PlayerSDKState } from '../types'

// ─── addToRecentlyPlayed spy ────────────────────────────────────────────────
// We intercept the aiSuggestion module in require.cache BEFORE QueueSynchronizer
// loads, so that both unfixed and fixed code get our spy version.
interface SpyCall {
  profileId: string
  entry: { spotifyTrackId: string; title: string; artist: string }
}
let addToRecentlyPlayedCalls: SpyCall[] = []

// Pre-load the real aiSuggestion module so it's in the cache
const aiSuggestionReal = require('@/services/aiSuggestion')
const aiSuggestionCacheKey = Object.keys(require.cache).find(
  (k) => k.includes('aiSuggestion') && k.includes('services') && !k.includes('__tests__') && !k.includes('constants')
)!

// Build a proxy that intercepts addToRecentlyPlayed but delegates everything else
const proxyExports = new Proxy(aiSuggestionReal, {
  get(target, prop, receiver) {
    if (prop === 'addToRecentlyPlayed') {
      return async (
        profileId: string,
        entry: { spotifyTrackId: string; title: string; artist: string }
      ) => {
        addToRecentlyPlayedCalls.push({ profileId, entry })
      }
    }
    return Reflect.get(target, prop, receiver)
  }
})

// Replace the cached module exports with our proxy
if (aiSuggestionCacheKey && require.cache[aiSuggestionCacheKey]) {
  require.cache[aiSuggestionCacheKey]!.exports = proxyExports
}

// NOW import QueueSynchronizer and other deps that may use aiSuggestion
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { QueueSynchronizer } = require('../QueueSynchronizer') as typeof import('../QueueSynchronizer')
const { playbackService } = require('@/services/player') as typeof import('@/services/player')
const { queueManager } = require('@/services/queueManager') as typeof import('@/services/queueManager')
const { DJService } = require('@/services/djService') as typeof import('@/services/djService')

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

// ─── Setup / Teardown ────────────────────────────────────────────────────────

beforeEach(async () => {
  await playbackService.waitForCompletion()
  localStorage.setItem('djMode', 'false')
  queueManager.updateQueue([])
  queueManager.setCurrentlyPlayingTrack(null)
  addToRecentlyPlayedCalls = []
})

afterEach(async () => {
  await playbackService.waitForCompletion()
  localStorage.setItem('djMode', 'false')
  mock.restoreAll()
})

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('Bug Condition: Track Finish Does Not Record Recently Played', () => {
  /**
   * Test case 1: Basic track finish
   *
   * Queue has an item with profile_id and matching spotify_track_id.
   * Track finishes naturally via handleTrackFinished().
   *
   * Expected (correct behavior): addToRecentlyPlayed is called
   * Actual (bug): addToRecentlyPlayed is NEVER called
   */
  it('should call addToRecentlyPlayed when a track finishes naturally', async () => {
    const controller = makeRecordingController()
    const synchronizer = new QueueSynchronizer(controller)

    const queueItem = makeQueueItem('track-abc123', 'Bohemian Rhapsody', 'profile-1')
    const nextItem = makeQueueItem('track-next', 'Another Song', 'profile-1')
    queueManager.updateQueue([queueItem, nextItem])
    queueManager.setCurrentlyPlayingTrack('track-abc123')

    const { lastKnownState, finishedState } = makeFinishedState(
      'track-abc123',
      'Bohemian Rhapsody',
      'Queen'
    )

    synchronizer.setLastKnownState(lastKnownState)
    synchronizer.setCurrentQueueTrack(queueItem)

    const djInstance = DJService.getInstance()
    mock.method(djInstance, 'maybeAnnounce', async () => {})

    await synchronizer.handleTrackFinished(finishedState)
    await playbackService.waitForCompletion()

    // EXPECTED: addToRecentlyPlayed should be called (track finished naturally)
    // BUG: addToRecentlyPlayed is NEVER called in handleTrackFinishedImpl
    assert.ok(
      addToRecentlyPlayedCalls.length > 0,
      'addToRecentlyPlayed() should be called when a track finishes naturally. ' +
        'Bug: handleTrackFinishedImpl() never calls addToRecentlyPlayed() — ' +
        'the recently_played_tracks table is never populated from actual playback.'
    )
  })

  /**
   * Test case 2: Correct arguments
   *
   * Verify addToRecentlyPlayed is called with:
   * - profileId from the queue item's profile_id
   * - spotifyTrackId from currentTrack.id
   * - title from currentTrack.name
   * - artist from currentTrack.artists[0].name
   */
  it('should call addToRecentlyPlayed with correct profileId, spotifyTrackId, title, and artist', async () => {
    const controller = makeRecordingController()
    const synchronizer = new QueueSynchronizer(controller)

    const queueItem = makeQueueItem('track-xyz789', 'Stairway to Heaven', 'venue-owner-42')
    const nextItem = makeQueueItem('track-next', 'Another Song', 'venue-owner-42')
    queueManager.updateQueue([queueItem, nextItem])
    queueManager.setCurrentlyPlayingTrack('track-xyz789')

    const { lastKnownState, finishedState } = makeFinishedState(
      'track-xyz789',
      'Stairway to Heaven',
      'Led Zeppelin'
    )

    synchronizer.setLastKnownState(lastKnownState)
    synchronizer.setCurrentQueueTrack(queueItem)

    const djInstance = DJService.getInstance()
    mock.method(djInstance, 'maybeAnnounce', async () => {})

    await synchronizer.handleTrackFinished(finishedState)
    await playbackService.waitForCompletion()

    // BUG: addToRecentlyPlayed is never called, so we can't check arguments
    assert.equal(
      addToRecentlyPlayedCalls.length,
      1,
      'addToRecentlyPlayed() should be called exactly once. ' +
        'Bug: it is never called in handleTrackFinishedImpl().'
    )

    const call = addToRecentlyPlayedCalls[0]
    assert.equal(
      call.profileId,
      'venue-owner-42',
      'profileId should come from the queue item\'s profile_id'
    )
    assert.equal(
      call.entry.spotifyTrackId,
      'track-xyz789',
      'spotifyTrackId should come from currentTrack.id'
    )
    assert.equal(
      call.entry.title,
      'Stairway to Heaven',
      'title should come from currentTrack.name'
    )
    assert.equal(
      call.entry.artist,
      'Led Zeppelin',
      'artist should come from currentTrack.artists[0].name'
    )
  })

  /**
   * Test case 3: No queue match
   *
   * Track finishes but no matching queue item exists (no profile_id available).
   * addToRecentlyPlayed should NOT be called.
   *
   * This case should PASS on unfixed code (correctly not called).
   */
  it('should NOT call addToRecentlyPlayed when no matching queue item exists', async () => {
    const controller = makeRecordingController()
    const synchronizer = new QueueSynchronizer(controller)

    // Queue has a DIFFERENT track — no match for the finishing track
    const unrelatedItem = makeQueueItem('track-different', 'Unrelated Song', 'profile-1')
    const nextItem = makeQueueItem('track-next', 'Next Song', 'profile-1')
    queueManager.updateQueue([unrelatedItem, nextItem])
    queueManager.setCurrentlyPlayingTrack('track-orphan')

    const { lastKnownState, finishedState } = makeFinishedState(
      'track-orphan',
      'Orphan Track With No Queue Match',
      'Unknown Artist'
    )

    synchronizer.setLastKnownState(lastKnownState)

    const djInstance = DJService.getInstance()
    mock.method(djInstance, 'maybeAnnounce', async () => {})

    await synchronizer.handleTrackFinished(finishedState)
    await playbackService.waitForCompletion()

    // EXPECTED: addToRecentlyPlayed should NOT be called (no profile_id available)
    // This should PASS on unfixed code — the function is never called at all
    assert.equal(
      addToRecentlyPlayedCalls.length,
      0,
      'addToRecentlyPlayed() should NOT be called when no matching queue item exists (no profile_id)'
    )
  })

  /**
   * Test case 4: Fuzzy name match
   *
   * Queue item name differs from SDK name by suffix (e.g., queue: "Dirrty",
   * SDK: "Dirrty (feat. Redman)"). The queue match should still work via
   * fuzzy name matching, and addToRecentlyPlayed should be called.
   */
  it('should call addToRecentlyPlayed when queue match is by fuzzy name only', async () => {
    const controller = makeRecordingController()
    const synchronizer = new QueueSynchronizer(controller)

    // Queue has "Dirrty" but SDK reports "Dirrty (feat. Redman)" with a different ID
    const queueItem = makeQueueItem('track-queue-id', 'Dirrty', 'profile-fuzzy')
    const nextItem = makeQueueItem('track-next', 'Next Song', 'profile-fuzzy')
    queueManager.updateQueue([queueItem, nextItem])
    queueManager.setCurrentlyPlayingTrack('track-relinked-id')

    // SDK reports a DIFFERENT spotify ID (relinked) with a featuring suffix
    const { lastKnownState, finishedState } = makeFinishedState(
      'track-relinked-id',
      'Dirrty (feat. Redman)',
      'Christina Aguilera'
    )

    synchronizer.setLastKnownState(lastKnownState)
    synchronizer.setCurrentQueueTrack(queueItem)

    const djInstance = DJService.getInstance()
    mock.method(djInstance, 'maybeAnnounce', async () => {})

    await synchronizer.handleTrackFinished(finishedState)
    await playbackService.waitForCompletion()

    // EXPECTED: addToRecentlyPlayed should be called with fuzzy-matched profile_id
    // BUG: addToRecentlyPlayed is NEVER called in handleTrackFinishedImpl
    assert.ok(
      addToRecentlyPlayedCalls.length > 0,
      'addToRecentlyPlayed() should be called when queue match is by fuzzy name. ' +
        'Bug: handleTrackFinishedImpl() never calls addToRecentlyPlayed() — ' +
        'even when a queue item is matched via fuzzy name, the track is not recorded.'
    )
  })
})
