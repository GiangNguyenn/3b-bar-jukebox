import test from 'node:test'
import assert from 'node:assert/strict'
import type { CandidateTrackMetrics, PopularityBand } from '../dgsTypes'
import type { TrackDetails } from '@/shared/types/spotify'
import { GRAVITY_LIMITS } from '../dgsTypes'
import { __dgsTestHelpers } from '../dgsEngine'

const {
  clampGravity,
  computeSimilarity,
  applyDiversityConstraints,
  getPopularityBand,
  extractTrackMetadata
} = __dgsTestHelpers

const baseTrack: TrackDetails = {
  id: 'track-base',
  name: 'Base Track',
  artists: [{ name: 'Base Artist', id: 'artist-base' }],
  album: {
    name: 'Album',
    images: [],
    release_date: '2024-01-01'
  },
  duration_ms: 180000,
  popularity: 50,
  preview_url: null,
  is_playable: true,
  explicit: false,
  uri: 'spotify:track:track-base'
}

const baseArtistProfile = {
  id: 'artist-base',
  name: 'Base Artist',
  genres: ['rock', 'indie']
}

function makeMetric(
  id: string,
  artistId: string,
  popularity: number,
  popularityBand: PopularityBand
): CandidateTrackMetrics {
  const track: TrackDetails = {
    ...baseTrack,
    id,
    name: `Track ${id}`,
    uri: `spotify:track:${id}`,
    artists: [{ name: artistId, id: artistId }],
    popularity
  }

  return {
    track,
    source: 'recommendations',
    artistId,
    artistName: artistId,
    artistGenres: [],
    simScore: Math.random(),
    aAttraction: Math.random(),
    bAttraction: Math.random(),
    gravityScore: Math.random(),
    stabilizedScore: Math.random(),
    finalScore: Math.random() + 0.5,
    popularityBand,
    vicinityDistances: {},
    currentSongAttraction: 0
  }
}

test('clampGravity enforces configured bounds', () => {
  assert.strictEqual(clampGravity(0.1), GRAVITY_LIMITS.min)
  assert.strictEqual(clampGravity(0.9), GRAVITY_LIMITS.max)
  assert.strictEqual(clampGravity(0.4), 0.4)
})

test('computeSimilarity returns high score for very similar tracks', () => {
  const baseMetadata = extractTrackMetadata(baseTrack, baseArtistProfile)
  const similarTrack: TrackDetails = {
    ...baseTrack,
    id: 'track-similar',
    popularity: 52,
    duration_ms: 182000
  }
  const similarMetadata = extractTrackMetadata(similarTrack, baseArtistProfile)
  const artistProfiles = new Map([[baseArtistProfile.id, baseArtistProfile]])

  const score = computeSimilarity(
    baseTrack,
    baseMetadata,
    similarTrack,
    similarMetadata,
    artistProfiles,
    new Map()
  )
  assert.ok(
    score.score > 0.7,
    `Expected high similarity score, got ${score.score}`
  )
})

test('getPopularityBand correctly categorizes popularity', () => {
  assert.strictEqual(getPopularityBand(20), 'low')
  assert.strictEqual(getPopularityBand(50), 'mid')
  assert.strictEqual(getPopularityBand(80), 'high')
  assert.strictEqual(getPopularityBand(33), 'low')
  assert.strictEqual(getPopularityBand(34), 'mid')
  assert.strictEqual(getPopularityBand(66), 'mid')
  assert.strictEqual(getPopularityBand(67), 'high')
})

test('applyDiversityConstraints ensures unique artists and balances popularity', () => {
  const metrics: CandidateTrackMetrics[] = [
    makeMetric('t1', 'artist-a', 20, 'low'),
    makeMetric('t2', 'artist-a', 25, 'low'),
    makeMetric('t3', 'artist-a', 30, 'low'),
    makeMetric('t4', 'artist-b', 50, 'mid'),
    makeMetric('t5', 'artist-c', 80, 'high'),
    makeMetric('t6', 'artist-d', 75, 'high')
  ]

  const result = applyDiversityConstraints(
    metrics,
    1,
    { player1: null, player2: null },
    { player1: 0.32, player2: 0.32 },
    'player1'
  )
  const selected = result.selected

  assert.ok(selected.length <= 5)

  // Ensure each artist appears at most once
  const artistCounts = selected.reduce<Record<string, number>>((acc, entry) => {
    const key = entry.artistId ?? entry.artistName ?? entry.track.id
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})

  Object.values(artistCounts).forEach((count) => {
    assert.strictEqual(count, 1, 'Each artist should appear exactly once')
  })

  const popularityBands = new Set(selected.map((entry) => entry.popularityBand))
  assert.ok(popularityBands.size >= 2)
})
