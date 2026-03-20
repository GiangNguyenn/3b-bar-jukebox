/**
 * Preservation Property Tests — Playback Controls Disabled Bug
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
 *
 * These tests MUST PASS on UNFIXED code.
 * They establish the baseline behavior that must be preserved after the fix.
 *
 * Preservation Properties:
 *   P2a: For any track transition (with or without DJ), the next track plays exactly once
 *   P2b: For any DJ announcement, maybeAnnounce is called before playNextTrackImpl
 *   P2c: For any concurrent handleTrackFinished events for the same track, only one transition executes
 *   P2d: Duck & Overlay — next track starts at reduced volume while DJ audio plays
 */

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { QueueSynchronizer } from '../playerLifecycle/QueueSynchronizer'
import { playbackService } from '../player/playbackService'
import { queueManager } from '@/services/queueManager'
import { DJService } from '@/services/djService'
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
  // Disable DJ mode by default so tests control it explicitly
  localStorage.setItem('djMode', 'false')
  localStorage.setItem('duckOverlayMode', 'false')
})

afterEach(async () => {
  await playbackService.waitForCompletion()
  localStorage.setItem('djMode', 'false')
  localStorage.setItem('duckOverlayMode', 'false')
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
   * P2a (with DJ) — Auto-play preservation with DJ enabled
   *
   * For any track transition with DJ enabled, the next track still plays exactly once
   * after the announcement completes.
   * Validates: Requirement 3.1, 3.3
   */
  describe('P2a (DJ): Next track plays exactly once after DJ announcement', () => {
    const nextTrackIds = ['track-dj-1', 'track-dj-2']

    for (const nextTrackId of nextTrackIds) {
      test(`plays exactly once after DJ announcement for: ${nextTrackId}`, async () => {
        // Enable DJ mode with 'always' frequency so maybeAnnounce always runs
        localStorage.setItem('djMode', 'true')
        localStorage.setItem('djFrequency', 'always')

        const controller = makeRecordingController()
        const synchronizer = new QueueSynchronizer(controller)

        const finishedTrackId = 'track-finished'
        const nextItem = makeQueueItem(nextTrackId)

        queueManager.updateQueue([nextItem])
        queueManager.setCurrentlyPlayingTrack(finishedTrackId)
        synchronizer.setLastKnownState(makePlayingState(finishedTrackId))

        // Mock maybeAnnounce to avoid real network calls but still execute
        const djInstance = DJService.getInstance()
        const originalMaybeAnnounce = djInstance.maybeAnnounce.bind(djInstance)
        djInstance.maybeAnnounce = async (
          _track: JukeboxQueueItem
        ): Promise<void> => {
          // Simulate a brief announcement without real network
          await new Promise((r) => setTimeout(r, 5))
        }

        try {
          const finishedState = makeFinishedState(finishedTrackId)
          await synchronizer.handleTrackFinished(finishedState)
        } finally {
          djInstance.maybeAnnounce = originalMaybeAnnounce
        }

        const played = controller.getPlayedTracks()

        // Property: exactly one play call was made even with DJ enabled
        assert.equal(
          played.length,
          1,
          `Expected exactly 1 play call with DJ enabled, got ${played.length}`
        )

        assert.ok(
          played[0].includes(nextTrackId),
          `Expected next track ${nextTrackId} to be played, got: ${played[0]}`
        )
      })
    }
  })

  /**
   * P2b — DJ sequencing: maybeAnnounce is called before playNextTrackImpl
   *
   * For any DJ announcement, maybeAnnounce must complete before playNextTrackImpl starts.
   * Validates: Requirement 3.3
   */
  describe('P2b: maybeAnnounce is called before playNextTrackImpl in DJ Mode', () => {
    test('maybeAnnounce completes before playTrackWithRetry is called', async () => {
      localStorage.setItem('djMode', 'true')
      localStorage.setItem('djFrequency', 'always')

      const callOrder: string[] = []

      const controller = {
        playTrackWithRetry: async (trackUri: string) => {
          callOrder.push(`play:${trackUri}`)
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

      // Mock maybeAnnounce to record when it's called and when it completes
      const djInstance = DJService.getInstance()
      const originalMaybeAnnounce = djInstance.maybeAnnounce.bind(djInstance)
      djInstance.maybeAnnounce = async (
        _track: JukeboxQueueItem
      ): Promise<void> => {
        callOrder.push('announce:start')
        await new Promise((r) => setTimeout(r, 10))
        callOrder.push('announce:end')
      }

      try {
        await synchronizer.handleTrackFinished(
          makeFinishedState(finishedTrackId)
        )
      } finally {
        djInstance.maybeAnnounce = originalMaybeAnnounce
      }

      // Property: announce:start and announce:end both appear before any play: call
      const announceEndIdx = callOrder.indexOf('announce:end')
      const playIdx = callOrder.findIndex((e) => e.startsWith('play:'))

      assert.ok(announceEndIdx !== -1, 'maybeAnnounce should have been called')
      assert.ok(playIdx !== -1, 'playTrackWithRetry should have been called')
      assert.ok(
        announceEndIdx < playIdx,
        `maybeAnnounce must complete before playNextTrackImpl starts. ` +
          `Call order: ${JSON.stringify(callOrder)}`
      )
    })

    // Test across multiple DJ frequencies to simulate "for any announcement"
    const frequencies = ['rarely', 'sometimes', 'often', 'always'] as const

    for (const freq of frequencies) {
      test(`sequencing preserved at DJ frequency: ${freq}`, async () => {
        localStorage.setItem('djMode', 'true')
        localStorage.setItem('djFrequency', freq)

        const callOrder: string[] = []

        const controller = {
          playTrackWithRetry: async (trackUri: string) => {
            callOrder.push(`play:${trackUri}`)
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

        const djInstance = DJService.getInstance()
        const originalMaybeAnnounce = djInstance.maybeAnnounce.bind(djInstance)
        let announceWasCalled = false
        djInstance.maybeAnnounce = async (
          _track: JukeboxQueueItem
        ): Promise<void> => {
          announceWasCalled = true
          callOrder.push('announce:start')
          await new Promise((r) => setTimeout(r, 5))
          callOrder.push('announce:end')
        }

        try {
          await synchronizer.handleTrackFinished(
            makeFinishedState(finishedTrackId)
          )
        } finally {
          djInstance.maybeAnnounce = originalMaybeAnnounce
        }

        // Property: if announce was called, it must complete before play
        if (announceWasCalled) {
          const announceEndIdx = callOrder.indexOf('announce:end')
          const playIdx = callOrder.findIndex((e) => e.startsWith('play:'))
          if (playIdx !== -1) {
            assert.ok(
              announceEndIdx < playIdx,
              `At freq=${freq}: announce must complete before play. Order: ${JSON.stringify(callOrder)}`
            )
          }
        }

        // Property: play was called exactly once regardless of whether announce ran
        const playCount = callOrder.filter((e) => e.startsWith('play:')).length
        assert.equal(
          playCount,
          1,
          `At freq=${freq}: expected exactly 1 play call, got ${playCount}`
        )
      })
    }
  })

  /**
   * P2b (fallback) — DJ announcement fetch failure graceful fallback (Requirement 3.4)
   *
   * When maybeAnnounce throws (e.g., network failure), the fix ensures the next track
   * still plays. maybeAnnounce runs OUTSIDE the serialized lock with a try/catch that
   * catches errors and continues to playNextTrackImpl.
   *
   * Validates: Requirement 3.4
   */
  describe('P2b (fallback): Baseline behavior when maybeAnnounce fails', () => {
    test('handleTrackFinished plays next track even when maybeAnnounce throws', async () => {
      localStorage.setItem('djMode', 'true')
      localStorage.setItem('djFrequency', 'always')

      const controller = makeRecordingController()
      const synchronizer = new QueueSynchronizer(controller)

      const finishedTrackId = 'track-finished'
      const nextItem = makeQueueItem('track-next')

      queueManager.updateQueue([nextItem])
      queueManager.setCurrentlyPlayingTrack(finishedTrackId)
      synchronizer.setLastKnownState(makePlayingState(finishedTrackId))

      // Mock maybeAnnounce to throw (simulates network failure)
      const djInstance = DJService.getInstance()
      const originalMaybeAnnounce = djInstance.maybeAnnounce.bind(djInstance)
      djInstance.maybeAnnounce = async (
        _track: JukeboxQueueItem
      ): Promise<void> => {
        throw new Error('Simulated DJ fetch failure')
      }

      let threwError = false
      try {
        await synchronizer.handleTrackFinished(
          makeFinishedState(finishedTrackId)
        )
      } catch {
        threwError = true
      } finally {
        djInstance.maybeAnnounce = originalMaybeAnnounce
      }

      // Fixed behavior (req 3.4): error is caught, next track still plays
      const played = controller.getPlayedTracks()
      assert.equal(
        threwError,
        false,
        `handleTrackFinished should NOT throw when maybeAnnounce throws — error should be caught`
      )
      assert.equal(
        played.length,
        1,
        `Next track should play even when maybeAnnounce throws. played=${JSON.stringify(played)}`
      )
    })
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

  /**
   * P2d — Duck & Overlay: next track starts at reduced volume
   *
   * When Duck & Overlay is enabled, the DJ audio plays while Spotify volume is ducked.
   * We observe that maybeAnnounce is called (which handles the ducking) and that
   * playNextTrackImpl is called after the announcement.
   * Validates: Requirement 3.5
   *
   * Note: We cannot directly test Spotify volume API calls in unit tests (no real device),
   * so we verify the structural behavior: maybeAnnounce runs before play, and play happens.
   */
  describe('P2d: Duck & Overlay — announcement plays before next track starts', () => {
    test('with Duck & Overlay enabled, maybeAnnounce runs before playNextTrackImpl', async () => {
      localStorage.setItem('djMode', 'true')
      localStorage.setItem('djFrequency', 'always')
      localStorage.setItem('duckOverlayMode', 'true')

      const callOrder: string[] = []

      const controller = {
        playTrackWithRetry: async (trackUri: string) => {
          callOrder.push(`play:${trackUri}`)
          return true
        },
        log: () => {},
        getDeviceId: () => 'device-1'
      }

      const synchronizer = new QueueSynchronizer(controller)

      const finishedTrackId = 'track-finished'
      const nextItem = makeQueueItem('track-next-duck')

      queueManager.updateQueue([nextItem])
      queueManager.setCurrentlyPlayingTrack(finishedTrackId)
      synchronizer.setLastKnownState(makePlayingState(finishedTrackId))

      const djInstance = DJService.getInstance()
      const originalMaybeAnnounce = djInstance.maybeAnnounce.bind(djInstance)
      djInstance.maybeAnnounce = async (
        _track: JukeboxQueueItem
      ): Promise<void> => {
        callOrder.push('announce:start')
        // Simulate duck overlay: non-blocking (waitForEnd=false in duck mode)
        // The real implementation calls playAudioBlob with waitForEnd=false when duck is enabled
        await new Promise((r) => setTimeout(r, 5))
        callOrder.push('announce:end')
      }

      try {
        await synchronizer.handleTrackFinished(
          makeFinishedState(finishedTrackId)
        )
      } finally {
        djInstance.maybeAnnounce = originalMaybeAnnounce
        localStorage.setItem('duckOverlayMode', 'false')
      }

      // Property: announce was called
      assert.ok(
        callOrder.includes('announce:start'),
        'maybeAnnounce should be called when Duck & Overlay is enabled'
      )

      // Property: play was called after announce started
      const announceIdx = callOrder.indexOf('announce:start')
      const playIdx = callOrder.findIndex((e) => e.startsWith('play:'))

      assert.ok(
        playIdx !== -1,
        'playNextTrackImpl should be called when Duck & Overlay is enabled'
      )
      assert.ok(
        announceIdx < playIdx,
        `announce must start before play. Order: ${JSON.stringify(callOrder)}`
      )
    })

    test('with Duck & Overlay disabled, next track still plays', async () => {
      localStorage.setItem('djMode', 'false')
      localStorage.setItem('duckOverlayMode', 'false')

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
