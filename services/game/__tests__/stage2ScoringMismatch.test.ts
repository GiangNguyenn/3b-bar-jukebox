import test from 'node:test'
import assert from 'node:assert/strict'
import {
    type CandidateTrackMetrics,
    type PlayerGravityMap,
    type PlayerId,
    type TargetProfile,
    type PopularityBand
} from '../dgsTypes'
import { applyDiversityConstraints } from '../dgsDiversity'
import { TrackDetails } from '@/shared/types/spotify'

// Mock data helpers
const mockTrack = (id: string, artistName: string): TrackDetails => ({
    id,
    name: `Track ${id}`,
    artists: [{ id: `artist_${id}`, name: artistName }],
    popularity: 50,
    duration_ms: 1000,
    album: { name: 'Album', images: [], release_date: '2023' },
    uri: `uri:${id}`,
    is_playable: true,
    preview_url: null,
    explicit: false
})

const mockMetric = (
    artistName: string,
    simScore: number,
    aAttraction: number
): CandidateTrackMetrics => ({
    track: mockTrack('1', artistName),
    source: 'recommendations',
    artistName,
    simScore, // This is the field used for filtering
    finalScore: 0.5,
    aAttraction,
    bAttraction: 0.5,
    gravityScore: 0.5,
    stabilizedScore: 0.5,
    popularityBand: 'mid' as PopularityBand,
    vicinityDistances: {},
    currentSongAttraction: 0
})

const targetProfiles: Record<PlayerId, TargetProfile | null> = {
    player1: {
        artist: { id: 'target1', name: 'Target Artist', genre: 'rock' },
        genres: ['rock'],
        spotifyId: 'target1'
    },
    player2: null
}

const baseGravities: PlayerGravityMap = { player1: 0.3, player2: 0.3 }

test('Stage 2 Scoring Mismatch Reproduction', async (t) => {
    await t.test(
        'BUG REPRODUCTION: Target Artist passes filter when simScore is High (Attraction Score used)',
        () => {
            // SCENARIO: The bug is that we pass Attraction Score (1.0 for Target) as simScore
            const metrics = [mockMetric('Target Artist', 1.0, 1.0)]

            const result = applyDiversityConstraints(
                metrics,
                1, // Round 1 (Early)
                targetProfiles,
                baseGravities,
                'player1'
            )

            // Because simScore is 1.0, it passes the > 0.4 check
            assert.equal(result.selected.length, 1, 'Target Artist should be selected because simScore (1.0) > 0.4')
            assert.ok(!result.filteredArtistNames.has('Target Artist'))
        }
    )

    await t.test(
        'DESIRED BEHAVIOR: Target Artist filtered when simScore is Low (Similarity Score used)',
        () => {
            // SCENARIO: We WANT to pass the actual Similarity to Current Track (e.g., 0.1) as simScore
            // even though Attraction (to Target) is 1.0
            const metrics = [mockMetric('Target Artist', 0.1, 1.0)]

            const result = applyDiversityConstraints(
                metrics,
                1, // Round 1 (Early)
                targetProfiles,
                baseGravities,
                'player1'
            )

            // Because simScore is 0.1, it fails the > 0.4 check
            assert.equal(result.selected.length, 0, 'Target Artist should be filtered because simScore (0.1) < 0.4')
            assert.ok(result.filteredArtistNames.has('Target Artist'))
        }
    )
})
