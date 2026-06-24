import test from 'node:test'
import assert from 'node:assert/strict'
import { playerLifecycleService } from '../playerLifecycle'
import { queueManager } from '../queueManager'
import { mockQueueItem } from './fixtures/mockQueueItem'

test('BUG REPRO: searchForAndRemoveTrack handles ID mismatch (Relinking)', async () => {
  const playedTrackId = 'id-relinked' // Different from mockQueueItem.tracks.spotify_track_id
  const trackName = mockQueueItem.tracks.name

  // Set the queue
  queueManager.updateQueue([mockQueueItem])

  // Spy on markAsPlayed
  let markAsPlayedCalledWith: string | null = null
  const originalMarkAsPlayed = queueManager.markAsPlayed

  // @ts-ignore
  queueManager.markAsPlayed = async (id: string) => {
    markAsPlayedCalledWith = id
  }

  try {
    // 2. Call markFinishedTrackAsPlayed directly on the QueueSynchronizer
    // @ts-ignore
    const queueSynchronizer = playerLifecycleService.queueSynchronizer
    await queueSynchronizer.markFinishedTrackAsPlayed(playedTrackId, trackName)

    // 3. Assertions
    // In the BUG state, this will fail because the code only matches by ID
    // In the FIXED state, this should pass because it falls back to name matching
    assert.equal(
      markAsPlayedCalledWith,
      'queue-uuid-1',
      'Should remove track from queue even if ID matches but name matches (Fuzzy Match)'
    )
  } finally {
    // Restore
    queueManager.markAsPlayed = originalMarkAsPlayed
    queueManager.updateQueue([])
  }
})
