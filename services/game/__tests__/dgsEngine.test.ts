import test from 'node:test'
import assert from 'node:assert/strict'
import type { CandidateTrackMetrics, PopularityBand } from '../dgsTypes'
import type { TrackDetails } from '@/shared/types/spotify'
import { GRAVITY_LIMITS } from '../dgsTypes'
import {
  clampGravity,
  computeSimilarity,
  getPopularityBand,
  extractTrackMetadata
} from '../dgsScoring'
import { applyDiversityConstraints } from '../dgsDiversity'

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
  popularityBand: PopularityBand,
  attraction?: number,
  currentSongAttraction: number = 0.5
): CandidateTrackMetrics {
  const track: TrackDetails = {
    ...baseTrack,
    id,
    name: `Track ${id}`,
    uri: `spotify:track:${id}`,
    artists: [{ name: artistId, id: artistId }],
    popularity
  }

  const baseAttraction = attraction ?? Math.random()
  // Ensure attraction values allow for categorization
  const aAttraction = baseAttraction
  const bAttraction = baseAttraction * 0.8 // Slightly different for player 2

  return {
    track,
    source: 'recommendations',
    artistId,
    artistName: artistId,
    artistGenres: [],
    simScore: Math.random(),
    aAttraction,
    bAttraction,
    gravityScore: Math.random(),
    stabilizedScore: Math.random(),
    finalScore: Math.random() + 0.5,
    popularityBand,
    vicinityDistances: {},
    currentSongAttraction
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
  const baseline = 0.5
  // Create metrics with varied attractions to allow 3-3-3 categorization
  // Closer: > 0.52, Neutral: 0.48-0.52, Further: < 0.48
  const metrics: CandidateTrackMetrics[] = [
    makeMetric('t1', 'artist-a', 20, 'low', 0.6, baseline), // Closer
    makeMetric('t2', 'artist-b', 25, 'low', 0.55, baseline), // Closer
    makeMetric('t3', 'artist-c', 30, 'low', 0.53, baseline), // Closer
    makeMetric('t4', 'artist-d', 50, 'mid', 0.5, baseline), // Neutral
    makeMetric('t5', 'artist-e', 80, 'high', 0.49, baseline), // Neutral
    makeMetric('t6', 'artist-f', 75, 'high', 0.51, baseline), // Neutral
    makeMetric('t7', 'artist-g', 40, 'mid', 0.45, baseline), // Further
    makeMetric('t8', 'artist-h', 60, 'mid', 0.4, baseline), // Further
    makeMetric('t9', 'artist-i', 70, 'high', 0.35, baseline) // Further
  ]

  const result = applyDiversityConstraints(
    metrics,
    1,
    { player1: null, player2: null },
    { player1: 0.32, player2: 0.32 },
    'player1'
  )
  const selected = result.selected

  // Should return up to 9 tracks (3-3-3 distribution) if available, but at least what we have
  assert.ok(selected.length <= 9, `Expected at most 9 tracks, got ${selected.length}`)
  assert.ok(selected.length >= 1, `Expected at least 1 track, got ${selected.length}`)

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
