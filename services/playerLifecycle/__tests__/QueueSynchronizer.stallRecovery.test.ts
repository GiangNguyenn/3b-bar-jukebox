/**
 * Playback-stall regressions: the jukebox stopping after a song and never
 * continuing until the page was reloaded.
 *
 * - isTrackFinished() missed a track that played through when the SDK sent no
 *   events mid-song (last known position was still near 0).
 * - playNextTrack() treated every failed play request as a bad track and
 *   deleted it, draining the queue during a device/network outage.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { QueueSynchronizer } from '../QueueSynchronizer'
import { queueManager } from '@/services/queueManager'
import type { JukeboxQueueItem } from '@/shared/types/queue'
import type { PlayerSDKState } from '../types'

const localStorageStore: Record<string, string> = {}
Object.defineProperty(globalThis, 'localStorage', {
  value: {
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
  },
  writable: true,
  configurable: true
})

const DURATION = 200_000

function makeState(
  trackId: string,
  paused: boolean,
  position: number
): PlayerSDKState {
  return {
    paused,
    position,
    duration: DURATION,
    track_window: {
      current_track: {
        id: trackId,
        uri: `spotify:track:${trackId}`,
        name: `Track ${trackId}`,
        artists: [{ name: 'Test Artist' }],
        album: { name: 'Test Album', images: [] },
        duration_ms: DURATION
      }
    }
  }
}

function makeQueueItem(spotifyTrackId: string): JukeboxQueueItem {
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
      duration_ms: DURATION,
      spotify_url: `https://open.spotify.com/track/${spotifyTrackId}`,
      release_year: 2023
    }
  }
}

function makeController(options: {
  playSucceeds: boolean
  trackAtFault: boolean
}) {
  const played: string[] = []
  return {
    played,
    playTrackWithRetry: (uri: string) => {
      played.push(uri)
      return Promise.resolve(options.playSucceeds)
    },
    wasLastPlayFailureTrackSpecific: () => options.trackAtFault,
    log: () => {},
    getDeviceId: () => 'device-1'
  }
}

void describe('isTrackFinished with no mid-song SDK events', () => {
  afterEach(() => {
    mock.restoreAll()
  })

  void it('detects the end when the only earlier event was at the start of the track', () => {
    const sync = new QueueSynchronizer(
      makeController({ playSucceeds: true, trackAtFault: false })
    )
    const start = Date.now()
    sync.setLastKnownState(makeState('a', false, 500))

    // The whole track has elapsed since that event
    mock.method(Date, 'now', () => start + DURATION)

    assert.equal(sync.isTrackFinished(makeState('a', true, 0)), true)
  })

  void it('does not treat an early stop as a finish', () => {
    const sync = new QueueSynchronizer(
      makeController({ playSucceeds: true, trackAtFault: false })
    )
    const start = Date.now()
    sync.setLastKnownState(makeState('a', false, 500))

    // Only a third of the track has elapsed
    mock.method(Date, 'now', () => start + DURATION / 3)

    assert.equal(sync.isTrackFinished(makeState('a', true, 0)), false)
  })
})

void describe('playNextTrack failure handling', () => {
  beforeEach(() => {
    queueManager.updateQueue([makeQueueItem('a'), makeQueueItem('b')])
    queueManager.setCurrentlyPlayingTrack(null)
  })

  afterEach(() => {
    mock.restoreAll()
    queueManager.updateQueue([])
  })

  void it('keeps the track queued when the failure is not the track’s fault', async () => {
    const markAsPlayed = mock.method(queueManager, 'markAsPlayed', () =>
      Promise.resolve()
    )
    const controller = makeController({
      playSucceeds: false,
      trackAtFault: false
    })
    const sync = new QueueSynchronizer(controller)

    await sync.playNextTrack(queueManager.getQueue()[0])

    assert.equal(markAsPlayed.mock.callCount(), 0)
    assert.deepEqual(controller.played, ['spotify:track:a'])
  })

  void it('drops a track Spotify refuses and moves on to the next one', async () => {
    const markAsPlayed = mock.method(queueManager, 'markAsPlayed', () =>
      Promise.resolve()
    )
    const controller = makeController({
      playSucceeds: false,
      trackAtFault: true
    })
    const sync = new QueueSynchronizer(controller)

    await sync.playNextTrack(queueManager.getQueue()[0])

    assert.ok(markAsPlayed.mock.callCount() >= 1)
    assert.deepEqual(controller.played, ['spotify:track:a', 'spotify:track:b'])
  })
})
