import test from 'node:test'
import assert from 'node:assert/strict'
import { playerLifecycleService } from '../playerLifecycle'

// Mock state helper
function createMockState(
  paused: boolean,
  position: number,
  duration: number,
  trackId: string = 'track-1'
) {
  return {
    paused,
    position,
    duration,
    track_window: {
      current_track: {
        id: trackId,
        uri: `spotify:track:${trackId}`,
        name: 'Test Track',
        artists: [{ name: 'Test Artist' }],
        album: {
          name: 'Test Album',
          images: [{ url: 'http://example.com/image.jpg' }]
        },
        duration_ms: duration
      },
      next_tracks: [],
      previous_tracks: []
    }
  }
}

test('BUG REPRO: isTrackFinished detects start-up buffering as track finish', async () => {
  // 1. Setup initial state: Playing at position 0 (Start of track)
  // This simulates the moment a track starts playing.
  const statePlayingAtStart = createMockState(false, 0, 180000)

  // We need to access private methods/propeties for this test
  // @ts-ignore
  const queueSynchronizer = playerLifecycleService.queueSynchronizer
  // @ts-ignore
  queueSynchronizer.setLastKnownState(statePlayingAtStart)

  // 2. Simulate "Buffering" state: Paused at position 0
  // valid Spotify SDK behavior: it often pauses briefly at 0 when loading
  const stateBuffering = createMockState(true, 0, 180000)

  // 3. Test isTrackFinished
  // @ts-ignore
  const isFinished = queueSynchronizer.isTrackFinished(stateBuffering)

  // CURRENT BEHAVIOR (BUG): Returns true because it sees "Paused at 0" and assumes finish
  // DESIRED BEHAVIOR: Should return false because we haven't played anything yet
  assert.equal(
    isFinished,
    false,
    'FIXED: Start-up buffering should NOT be detected as track finish'
  )
})
