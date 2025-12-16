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
    'allows target artist in Round 8+ (Target Boost) even with low similarity',
    () => {
      const metrics = [mockMetric('Target Artist', 0.1)] // Low sim
      const result = applyDiversityConstraints(
        metrics,
        8, // Round 8 (Target Boost)
        targetProfiles,
        baseGravities,
        'player1'
      )
      assert.equal(result.selected.length, 1)
    }
  )

  await t.test(
    'allows target artist with MAX gravity (0.7) even with low similarity',
    () => {
      const metrics = [mockMetric('Target Artist', 0.1)] // Low sim
      const highGravities = { ...baseGravities, player1: GRAVITY_LIMITS.max } // 0.7
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
    'does NOT allow target artist with just below MAX gravity (0.69) and low similarity',
    () => {
      const metrics = [mockMetric('Target Artist', 0.1)] // Low sim
      const highGravities = { ...baseGravities, player1: 0.69 }
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
