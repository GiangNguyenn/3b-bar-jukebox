import test from 'node:test'
import assert from 'node:assert/strict'
import { playerLifecycleService } from '../playerLifecycle'
import { queueManager } from '../queueManager'
import { JukeboxQueueItem } from '@/shared/types/queue'
import { PlayerSDKState } from '../playerLifecycle/types'

test('BUG REPRO: syncQueueWithPlayback handles ID mismatch (Relinking)', async () => {
  // 1. Setup Queue with a track that has ID 'id-original'
  const originalTrackId = 'id-original'
  const relinkedTrackId = 'id-relinked' // Different ID
  const trackName = 'Wonderwall - Remastered'

  const mockQueueItem: JukeboxQueueItem = {
    id: 'queue-uuid-1',
    track_id: 'db-id-1',
    profile_id: 'user-1',
    tracks: {
      id: 'db-id-1',
      spotify_track_id: originalTrackId,
      name: trackName,
      artist: 'Oasis',
      duration_ms: 200000,
      album: 'Morning Glory',
      genre: 'Rock',
      created_at: new Date().toISOString(),
      popularity: 80,
      spotify_url: 'https://open.spotify.com/track/id-original',
      release_year: 1995
    },
    votes: 0,
    queued_at: new Date().toISOString()
  }

  // Set the queue
  queueManager.updateQueue([mockQueueItem])
  // Ensure we are not currently playing anything initially
  queueManager.setCurrentlyPlayingTrack(null)

  // Spy on queueSynchronizer.playNextTrack
  let playNextTrackCalled = false
  // @ts-ignore
  const queueSynchronizer = playerLifecycleService.queueSynchronizer
  const originalPlayNextTrack = queueSynchronizer.playNextTrack

  // @ts-ignore
  queueSynchronizer.playNextTrack = async (track: JukeboxQueueItem) => {
    console.log(
      'QueueSynchronizer.playNextTrack called with',
      track.tracks.name
    )
    playNextTrackCalled = true
  }

  // Mock State with RELINKED ID
  const mockState: PlayerSDKState = {
    paused: false,
    position: 1000,
    duration: 200000,
    track_window: {
      current_track: {
        id: relinkedTrackId, // <--- Different ID!
        uri: `spotify:track:${relinkedTrackId}`,
        name: trackName, // <--- Same Name!
        artists: [{ name: 'Oasis' }],
        album: { name: 'Morning Glory', images: [] },
        duration_ms: 200000
      }
    }
  }

  try {
    // 2. Call syncQueueWithPlayback
    // @ts-ignore accessing private method
    playerLifecycleService.syncQueueWithPlayback(mockState)

    // 3. Assertions
    // In the BUG state, playNextTrackCalled will be TRUE because it sees a mismatch and tries to "fix" it.
    // We want to ASSERT that it IS called (to prove the bug) or NOT called (to prove the fix).
    // For reproduction of the BUG, we assert TRUE.
    // Wait, the goal of the test *after fix* is to pass when it handles it correctly (i.e. does NOT call playNextTrack).
    // So for now, I expect this test to FAIL (playNextTrackCalled === true) if I assert false.
    // Or I can assert `playNextTrackCalled === true` to confirm the bug exists right now.

    // Let's assert that it SHOULD be false (Future behavior). So currently it should fail.
    assert.equal(
      playNextTrackCalled,
      false,
      'Should NOT trigger playNextTrack when name matches despite ID mismatch'
    )
  } finally {
    // Restore
    // @ts-ignore
    queueSynchronizer.playNextTrack = originalPlayNextTrack
    queueManager.updateQueue([])
    queueManager.setCurrentlyPlayingTrack(null)
  }
})
