/**
 * After hours of use the Web Playback SDK player can lose its Spotify device
 * registration without emitting 'not_ready'. The player still looked 'ready',
 * so nothing recreated it and every play failed with "Device not found".
 * verifyDeviceRegistered must flag that for recovery, but only when Spotify
 * actually confirms the device is gone.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { PlayerLifecycleService } from '@/services/playerLifecycle'
import { spotifyPlayerStore } from '@/hooks/spotifyPlayerStore'
import { tokenManager } from '@/shared/token/tokenManager'
import { queueManager } from '@/services/queueManager'

const realFetch = globalThis.fetch
const DEVICE_ID = 'jukebox-device'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function makeService(): PlayerLifecycleService {
  const service = new PlayerLifecycleService()
  // Simulate a player that completed initialization with this device
  ;(
    service as unknown as { sdkLifecycleManager: { deviceId: string } }
  ).sdkLifecycleManager.deviceId = DEVICE_ID
  return service
}

function setReady(): void {
  spotifyPlayerStore.setState({
    status: 'ready',
    isReady: true,
    lastStatusChange: 0
  })
}

const realNow = Date.now.bind(Date)
let clockOffset = 0

void describe('verifyDeviceRegistered', () => {
  beforeEach(() => {
    // Step the clock past sendApiRequest's 5s read de-dup window and the
    // registration-check cooldown, so each test sees only its own responses.
    clockOffset += 60_000
    mock.method(Date, 'now', () => realNow() + clockOffset)
    mock.method(tokenManager, 'getToken', () => Promise.resolve('token'))
    setReady()
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    mock.restoreAll()
  })

  void it('flags the player for recreation when Spotify no longer lists the device', async () => {
    globalThis.fetch = ((url: string) => {
      if (String(url).includes('/me/player/devices')) {
        return Promise.resolve(
          jsonResponse(200, {
            devices: [{ id: 'phone', is_active: true, name: 'Phone' }]
          })
        )
      }
      // Playback state shows some other device, not ours
      return Promise.resolve(
        jsonResponse(200, { device: { id: 'phone', is_active: true } })
      )
    }) as typeof fetch

    const registered =
      await makeService().verifyDeviceRegistered('test: not listed')

    assert.equal(registered, false)
    assert.equal(spotifyPlayerStore.getState().status, 'error')
  })

  void it('does not recreate the player when the device list request fails', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        jsonResponse(400, { error: { message: 'Bad request' } })
      )) as typeof fetch

    const registered = await makeService().verifyDeviceRegistered(
      'test: request failed'
    )

    assert.equal(registered, true)
    assert.equal(spotifyPlayerStore.getState().status, 'ready')
  })

  void it('leaves a healthy, listed device alone', async () => {
    globalThis.fetch = ((url: string) => {
      if (String(url).includes('/me/player/devices')) {
        return Promise.resolve(
          jsonResponse(200, {
            devices: [{ id: DEVICE_ID, is_active: true, name: 'Jukebox' }]
          })
        )
      }
      return Promise.resolve(
        jsonResponse(200, { device: { id: DEVICE_ID, is_active: true } })
      )
    }) as typeof fetch

    const registered =
      await makeService().verifyDeviceRegistered('test: listed')

    assert.equal(registered, true)
    assert.equal(spotifyPlayerStore.getState().status, 'ready')
  })
})

// ─── Resuming after the player is recreated ─────────────────────────────────

const TRACK_DURATION = 200_000

function sdkState(position: number, paused = false) {
  return {
    paused,
    position,
    duration: TRACK_DURATION,
    track_window: {
      current_track: {
        id: 'song-a',
        uri: 'spotify:track:song-a',
        name: 'Song A',
        artists: [{ name: 'Artist' }],
        album: { name: 'Album', images: [] },
        duration_ms: TRACK_DURATION
      }
    }
  }
}

type ServiceInternals = {
  queueSynchronizer: {
    setLastKnownState(state: ReturnType<typeof sdkState> | null): void
  }
}

void describe('resume after recovery', () => {
  afterEach(() => {
    mock.restoreAll()
  })

  void it('resumes a song that dropped mid-play where it had got to', async () => {
    const start = realNow()
    mock.method(Date, 'now', () => start)
    const service = makeService()
    ;(
      service as unknown as ServiceInternals
    ).queueSynchronizer.setLastKnownState(sdkState(30_000))
    const play = mock.method(service, 'playTrackWithRetry', () =>
      Promise.resolve(true)
    )

    // 40s of playback since the SDK's last event, then the device is lost
    mock.method(Date, 'now', () => start + 40_000)
    service.captureResumePoint()
    service.onPlayerReady('new-device')
    await new Promise((resolve) => setTimeout(resolve, 10))

    assert.equal(play.mock.callCount(), 1)
    const [uri, device, , positionMs] = play.mock.calls[0].arguments
    assert.equal(uri, 'spotify:track:song-a')
    assert.equal(device, 'new-device')
    assert.equal(positionMs, 70_000)
  })

  void it('starts the next song when the drop happened at the end of one', () => {
    const service = makeService()
    ;(
      service as unknown as ServiceInternals
    ).queueSynchronizer.setLastKnownState(sdkState(TRACK_DURATION - 1000, true))
    const nextItem = { id: 'queue-b', tracks: { name: 'Song B' } }
    mock.method(queueManager, 'getNextTrack', () => nextItem)
    const play = mock.method(service, 'playTrackWithRetry', () =>
      Promise.resolve(true)
    )
    const playNext = mock.method(service, 'playNextTrack', () =>
      Promise.resolve()
    )

    service.captureResumePoint()
    service.onPlayerReady('new-device')

    // The finished song is not resumed; the next queued one is started
    assert.equal(play.mock.callCount(), 0)
    assert.equal(playNext.mock.callCount(), 1)
    assert.equal(playNext.mock.calls[0].arguments[0], nextItem)
  })

  void it('does not start music the user had paused', () => {
    const service = makeService()
    ;(
      service as unknown as ServiceInternals
    ).queueSynchronizer.setLastKnownState(sdkState(30_000, true))
    service.setManualPause(true)
    const play = mock.method(service, 'playTrackWithRetry', () =>
      Promise.resolve(true)
    )
    const playNext = mock.method(service, 'playNextTrack', () =>
      Promise.resolve()
    )

    service.captureResumePoint()
    service.onPlayerReady('new-device')

    assert.equal(play.mock.callCount(), 0)
    assert.equal(playNext.mock.callCount(), 0)
  })

  void it('requests an immediate rebuild when the device is confirmed lost', () => {
    setReady()
    spotifyPlayerStore.setState({ recoveryRequested: false })

    makeService().reportDeviceLost('test')

    assert.equal(spotifyPlayerStore.getState().recoveryRequested, true)
    assert.equal(spotifyPlayerStore.getState().status, 'error')

    spotifyPlayerStore.getState().setStatus('ready')
    // setStatus may defer inside the debounce window; force past it
    spotifyPlayerStore.setState({ lastStatusChange: 0 })
    spotifyPlayerStore.getState().setStatus('ready')
    assert.equal(spotifyPlayerStore.getState().recoveryRequested, false)
  })
})
