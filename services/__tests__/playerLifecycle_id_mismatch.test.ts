import test from 'node:test'
import assert from 'node:assert/strict'
import { playerLifecycleService } from '../playerLifecycle'
import { queueManager } from '../queueManager'
import { JukeboxQueueItem } from '@/shared/types/queue'

test('BUG REPRO: searchForAndRemoveTrack handles ID mismatch (Relinking)', async () => {
    // 1. Setup Queue with a track that has ID 'id-original'
    // using a track name that is characteristic of the issue
    const originalTrackId = 'id-original'
    const playedTrackId = 'id-relinked' // Different ID
    const trackName = 'Wonderwall - Remastered' // Exact name match

    const mockQueueItem: JukeboxQueueItem = {
        id: 'queue-uuid-1',
        user_id: 'user-1',
        tracks: {
            id: 'db-id-1',
            spotify_track_id: originalTrackId,
            name: trackName,
            artist: 'Oasis',
            image_url: 'http://example.com/img.jpg',
            duration_ms: 200000,
            album: 'Morning Glory'
        },
        votes: 0,
        super_votes: 0,
        queued_at: new Date().toISOString(),
        is_hero_request: false,
        status: 'queued'
    }

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
        // 2. Call markFinishedTrackAsPlayed with the RELINKED ID
        // @ts-ignore доступаемся к приватному методу
        await playerLifecycleService.markFinishedTrackAsPlayed(playedTrackId, trackName)

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
