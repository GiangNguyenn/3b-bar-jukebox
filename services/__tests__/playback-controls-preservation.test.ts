/**
 * Preservation Property Tests — Auto-Play and Race Condition Prevention
 *
 * Properties:
 *   P2a: For any track transition, the next track plays exactly once
 *   P2c: For any concurrent handleTrackFinished events for the same track, only one transition executes
 *   P2d: Next track plays without announcement
 */

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { QueueSynchronizer } from '../playerLifecycle/QueueSynchronizer'
import { playbackService } from '../player/playbackService'
import { queueManager } from '@/services/queueManager'
import type { JukeboxQueueItem } from '@/shared/types/queue'
import type { PlayerSDKState } from '../playerLifecycle/types'

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

function makeFinishedState(trackId = 'track-finished'): PlayerSDKState {
  return {
    paused: true,
    position: 0,
    duration: 200000,
    track_window: {
      current_track: {
        id: trackId,
        uri: `spotify:track:${trackId}`,
        name: 'Finished Track',
        artists: [{ name: 'Artist' }],
        album: { name: 'Album', images: [] },
        duration_ms: 200000
      }
    }
  }
}

function makePlayingState(trackId = 'track-finished'): PlayerSDKState {
  return {
    paused: false,
    position: 60000,
    duration: 200000,
    track_window: {
      current_track: {
        id: trackId,
        uri: `spotify:track:${trackId}`,
        name: 'Playing Track',
        artists: [{ name: 'Artist' }],
        album: { name: 'Album', images: [] },
        duration_ms: 200000
      }
    }
  }
}

function makeQueueItem(
  spotifyTrackId: string,
  overrides?: Partial<JukeboxQueueItem>
): JukeboxQueueItem {
  return {
    id: `queue-${spotifyTrackId}`,
    profile_id: 'profile-1',
    track_id: spotifyTrackId,
    votes: 0,
    queued_at: new Date().toISOString(),
    tracks: {
      id: spotifyTrackId,
      spotify_track_id: spotifyTrackId,
      name: `Track ${spotifyTrackId}`,
      artist: 'Test Artist',
      album: 'Test Album',
      genre: 'Pop',
      created_at: new Date().toISOString(),
      popularity: 60,
      duration_ms: 180000,
      spotify_url: `https://open.spotify.com/track/${spotifyTrackId}`,
      release_year: 2023
    },
    ...overrides
  }
}

/**
 * Creates a PlaybackController that records playTrackWithRetry calls.
 * Returns success=true immediately (no real Spotify API).
 */
function makeRecordingController() {
  const playedTracks: string[] = []
  const logs: string[] = []
  return {
    playTrackWithRetry: async (trackUri: string) => {
      playedTracks.push(trackUri)
      return true
    },
    log: (_level: string, msg: string) => {
      logs.push(msg)
    },
    getDeviceId: () => 'device-1',
    getPlayedTracks: () => playedTracks,
    getLogs: () => logs
  }
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────

beforeEach(async () => {
  await playbackService.waitForCompletion()
})

afterEach(async () => {
  await playbackService.waitForCompletion()
})

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('Preservation: Auto-Play, DJ Sequencing, and Race Condition Prevention', () => {
  /**
   * P2a — Auto-play preservation (no DJ)
   *
   * For any track transition without DJ, the next track plays exactly once.
   * Validates: Requirement 3.1
   *
   * We test across multiple queue configurations to simulate "for any" semantics.
   */
  describe('P2a: Next track plays exactly once after normal transition (no DJ)', () => {
    // Parameterized over several next-track IDs to simulate property-style coverage
    const nextTrackIds = [
      'track-next-1',
      'track-next-2',
      'track-next-abc',
      'track-xyz-999'
    ]

    for (const nextTrackId of nextTrackIds) {
      test(`plays exactly once for next track: ${nextTrackId}`, async () => {
        const controller = makeRecordingController()
        const synchronizer = new QueueSynchronizer(controller)

        const finishedTrackId = 'track-finished'
        const nextItem = makeQueueItem(nextTrackId)

        // Set up queue: finished track is "currently playing", next track is queued
        queueManager.updateQueue([nextItem])
        queueManager.setCurrentlyPlayingTrack(finishedTrackId)

        // Set last known state so isTrackFinished works correctly
        synchronizer.setLastKnownState(makePlayingState(finishedTrackId))

        // Trigger track finished
        const finishedState = makeFinishedState(finishedTrackId)
        await synchronizer.handleTrackFinished(finishedState)

        const played = controller.getPlayedTracks()

        // Property: exactly one play call was made
        assert.equal(
          played.length,
          1,
          `Expected exactly 1 play call, got ${played.length}. Played: ${JSON.stringify(played)}`
        )

        // Property: the correct next track was played
        assert.ok(
          played[0].includes(nextTrackId),
          `Expected next track ${nextTrackId} to be played, got: ${played[0]}`
        )
      })
    }
  })



  /**
   * P2c — Race condition prevention: serialized queue prevents concurrent execution
   *
   * The serialized `playbackService` operation queue ensures that concurrent
   * `handleTrackFinished` events for the same track run sequentially, not simultaneously.
   * This prevents race conditions (e.g., two tracks playing at once).
   *
   * Observation on unfixed code:
   * - The serialized queue ensures sequential execution (no concurrent play calls)
   * - The TrackDuplicateDetector prevents a third+ call for the same track
   * - Two sequential calls for the same track: the first plays, the second also plays
   *   (because queueManager.setCurrentlyPlayingTrack(null) in step 2 resets state)
   *
   * Validates: Requirement 3.6 (serialized queue prevents concurrent execution)
   */
  describe('P2c: Serialized queue prevents concurrent execution of track transitions', () => {
    test('concurrent handleTrackFinished calls run sequentially (not concurrently)', async () => {
      const executionOrder: string[] = []
      let concurrentCount = 0
      let maxConcurrent = 0

      const controller = {
        playTrackWithRetry: async (trackUri: string) => {
          concurrentCount++
          maxConcurrent = Math.max(maxConcurrent, concurrentCount)
          executionOrder.push(`play-start:${trackUri}`)
          await new Promise((r) => setTimeout(r, 5)) // simulate async work
          executionOrder.push(`play-end:${trackUri}`)
          concurrentCount--
          return true
        },
        log: () => {},
        getDeviceId: () => 'device-1'
      }

      const synchronizer = new QueueSynchronizer(controller)

      const finishedTrackId = 'track-finished'
      const nextItem = makeQueueItem('track-next')

      queueManager.updateQueue([nextItem])
      queueManager.setCurrentlyPlayingTrack(finishedTrackId)
      synchronizer.setLastKnownState(makePlayingState(finishedTrackId))

      const finishedState = makeFinishedState(finishedTrackId)

      // Fire two concurrent handleTrackFinished events
      await Promise.all([
        synchronizer.handleTrackFinished(finishedState),
        synchronizer.handleTrackFinished(finishedState)
      ])

      // Property: max concurrent play calls is 1 (serialized, not concurrent)
      assert.equal(
        maxConcurrent,
        1,
        `Expected max 1 concurrent play call (serialized queue), got ${maxConcurrent}. ` +
          `Execution order: ${JSON.stringify(executionOrder)}`
      )

      // Property: play-start and play-end are interleaved correctly (no overlap)
      // Each play-start must be followed by its play-end before the next play-start
      for (let i = 0; i < executionOrder.length - 1; i++) {
        if (executionOrder[i].startsWith('play-start:')) {
          const trackUri = executionOrder[i].replace('play-start:', '')
          const nextEvent = executionOrder[i + 1]
          assert.equal(
            nextEvent,
            `play-end:${trackUri}`,
            `play-start:${trackUri} must be immediately followed by play-end:${trackUri}. ` +
              `Got: ${nextEvent}. Order: ${JSON.stringify(executionOrder)}`
          )
        }
      }
    })

    test('TrackDuplicateDetector prevents a third+ call for the same track', async () => {
      const controller = makeRecordingController()
      const synchronizer = new QueueSynchronizer(controller)

      const finishedTrackId = 'track-finished'
      const nextItem = makeQueueItem('track-next')

      queueManager.updateQueue([nextItem])
      queueManager.setCurrentlyPlayingTrack(finishedTrackId)
      synchronizer.setLastKnownState(makePlayingState(finishedTrackId))

      const finishedState = makeFinishedState(finishedTrackId)

      // Fire three sequential calls for the same track
      await synchronizer.handleTrackFinished(finishedState)
      await synchronizer.handleTrackFinished(finishedState)
      await synchronizer.handleTrackFinished(finishedState)

      const played = controller.getPlayedTracks()

      // Observation: the third call is deduplicated by TrackDuplicateDetector
      // (lastProcessedTrackId === 'track-finished' after the second call)
      // The first two calls may both play (baseline behavior), but the third is blocked
      assert.ok(
        played.length <= 2,
        `Expected at most 2 play calls (third deduplicated), got ${played.length}. ` +
          `Played: ${JSON.stringify(played)}`
      )
    })

    test('different tracks do NOT deduplicate each other', async () => {
      const controller = makeRecordingController()
      const synchronizer = new QueueSynchronizer(controller)

      const track1Id = 'track-first'
      const track2Id = 'track-second'
      const track3Id = 'track-third'

      // Set up queue with multiple tracks
      const item2 = makeQueueItem(track2Id)
      const item3 = makeQueueItem(track3Id)

      // First transition: track1 → track2
      queueManager.updateQueue([item2, item3])
      queueManager.setCurrentlyPlayingTrack(track1Id)
      synchronizer.setLastKnownState(makePlayingState(track1Id))

      await synchronizer.handleTrackFinished(makeFinishedState(track1Id))

      // Second transition: track2 → track3
      queueManager.updateQueue([item3])
      queueManager.setCurrentlyPlayingTrack(track2Id)
      synchronizer.setLastKnownState(makePlayingState(track2Id))

      await synchronizer.handleTrackFinished(makeFinishedState(track2Id))

      const played = controller.getPlayedTracks()

      // Property: two distinct track transitions → two play calls
      assert.equal(
        played.length,
        2,
        `Expected 2 play calls for 2 distinct transitions, got ${played.length}. ` +
          `Played: ${JSON.stringify(played)}`
      )
    })
  })

  describe('P2d: next track plays without duck/overlay', () => {
    test('next track plays when there is no announcement', async () => {
      const controller = makeRecordingController()
      const synchronizer = new QueueSynchronizer(controller)

      const finishedTrackId = 'track-finished'
      const nextItem = makeQueueItem('track-next-noduck')

      queueManager.updateQueue([nextItem])
      queueManager.setCurrentlyPlayingTrack(finishedTrackId)
      synchronizer.setLastKnownState(makePlayingState(finishedTrackId))

      await synchronizer.handleTrackFinished(makeFinishedState(finishedTrackId))

      const played = controller.getPlayedTracks()
      assert.equal(
        played.length,
        1,
        'Next track should play without Duck & Overlay'
      )
      assert.ok(
        played[0].includes('track-next-noduck'),
        `Expected track-next-noduck, got: ${played[0]}`
      )
    })
  })
})
