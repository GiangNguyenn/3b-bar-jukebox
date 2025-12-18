import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GRAVITY_LIMITS,
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
  simScore: number
): CandidateTrackMetrics => ({
  track: mockTrack('1', artistName),
  source: 'recommendations',
  artistName,
  simScore,
  finalScore: 0.5,
  aAttraction: 0.5,
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

test('applyDiversityConstraints - Filtering Logic', async (t) => {
  await t.test(
    'filters target artist with low similarity in early rounds',
    () => {
      const metrics = [mockMetric('Target Artist', 0.1)] // Low sim
      const result = applyDiversityConstraints(
        metrics,
        1, // Round 1
        targetProfiles,
        baseGravities,
        'player1'
      )
      assert.equal(result.selected.length, 0)
      assert.ok(result.filteredArtistNames.has('Target Artist'))
    }
  )

  await t.test(
    'allows target artist with high similarity in early rounds',
    () => {
      const metrics = [mockMetric('Target Artist', 0.8)] // High sim
      const result = applyDiversityConstraints(
        metrics,
        1, // Round 1
        targetProfiles,
        baseGravities,
        'player1'
      )
      assert.equal(result.selected.length, 1)
    }
  )

  await t.test(
    'allows target artist in Round 10+ (Target Boost) even with low similarity',
    () => {
      const metrics = [mockMetric('Target Artist', 0.1)] // Low sim
      const result = applyDiversityConstraints(
        metrics,
        10, // Round 10 (Target Boost)
        targetProfiles,
        baseGravities,
        'player1'
      )
      assert.equal(result.selected.length, 1)
    }
  )

  await t.test(
    'does NOT allow target artist in Round 9 even with low similarity',
    () => {
      const metrics = [mockMetric('Target Artist', 0.1)] // Low sim
      const result = applyDiversityConstraints(
        metrics,
        9, // Round 9 (before threshold)
        targetProfiles,
        baseGravities,
        'player1'
      )
      assert.equal(result.selected.length, 0)
    }
  )

  await t.test(
    'allows target artist with gravity > 0.59 (80% influence) even with low similarity',
    () => {
      const metrics = [mockMetric('Target Artist', 0.1)] // Low sim
      const highGravities = { ...baseGravities, player1: 0.6 } // > 0.59 (80% influence)
      const result = applyDiversityConstraints(
        metrics,
        1, // Early round
        targetProfiles,
        highGravities,
        'player1'
      )
      assert.equal(result.selected.length, 1)
    }
  )

  await t.test(
    'does NOT allow target artist with gravity exactly 0.59 (threshold is > 0.59)',
    () => {
      const metrics = [mockMetric('Target Artist', 0.1)] // Low sim
      const highGravities = { ...baseGravities, player1: 0.59 } // Exactly 80% influence, but threshold is > 0.59
      const result = applyDiversityConstraints(
        metrics,
        1, // Early round
        targetProfiles,
        highGravities,
        'player1'
      )
      // Implementation uses > 0.59, so 0.59 should NOT be allowed
      assert.equal(
        result.selected.length,
        0,
        '0.59 should not be allowed (threshold is > 0.59)'
      )
    }
  )

  await t.test(
    'does NOT allow target artist with gravity <= 0.59 (below 80% influence) and low similarity',
    () => {
      const metrics = [mockMetric('Target Artist', 0.1)] // Low sim
      const highGravities = { ...baseGravities, player1: 0.58 } // Just below 80% influence
      const result = applyDiversityConstraints(
        metrics,
        1, // Early round
        targetProfiles,
        highGravities,
        'player1'
      )
      assert.equal(result.selected.length, 0)
    }
  )
})
