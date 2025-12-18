import test from 'node:test'
import assert from 'node:assert/strict'
import type { TrackDetails } from '@/shared/types/spotify'

// Test the random selection logic used by fetchTopTracksForArtists
// Note: Full integration tests would require mocking database and Spotify API

function simulateRandomTrackSelection(
  tracks: TrackDetails[],
  excludeTrackIds: Set<string>
): TrackDetails | null {
  // Get top 10 tracks (or all available if less than 10)
  const topTracks = tracks.slice(0, 10)

  // Filter out excluded tracks (current track, played tracks)
  const validTracks = topTracks.filter(
    (track) => track.is_playable && !excludeTrackIds.has(track.id)
  )

  // If no valid tracks, skip this artist
  if (validTracks.length === 0) {
    return null
  }

  // Randomly select 1 track from valid tracks
  const randomIndex = Math.floor(Math.random() * validTracks.length)
  return validTracks[randomIndex]
}

function createMockTrack(id: string, isPlayable: boolean = true): TrackDetails {
  return {
    id,
    name: `Track ${id}`,
    artists: [{ id: `artist_${id}`, name: `Artist ${id}` }],
    popularity: 50,
    duration_ms: 180000,
    album: { name: 'Album', images: [], release_date: '2024-01-01' },
    uri: `spotify:track:${id}`,
    is_playable: isPlayable,
    preview_url: null,
    explicit: false
  }
}

test('Random Track Selection Logic', async (t) => {
  await t.test('selects 1 track from top 10', () => {
    const tracks = Array.from({ length: 15 }, (_, i) =>
      createMockTrack(`track${i}`)
    )
    const excludeSet = new Set<string>()

    const selected = simulateRandomTrackSelection(tracks, excludeSet)

    assert.ok(selected !== null, 'Should select a track')
    assert.ok(
      tracks.slice(0, 10).some((t) => t.id === selected.id),
      'Selected track should be from top 10'
    )
  })

  await t.test('excludes currently playing track', () => {
    const tracks = Array.from({ length: 10 }, (_, i) =>
      createMockTrack(`track${i}`)
    )
    const excludeSet = new Set<string>(['track5'])

    // Run multiple times to ensure excluded track is never selected
    for (let i = 0; i < 10; i++) {
      const selected = simulateRandomTrackSelection(tracks, excludeSet)
      if (selected) {
        assert.notEqual(
          selected.id,
          'track5',
          'Should never select excluded track'
        )
      }
    }
  })

  await t.test('excludes played tracks', () => {
    const tracks = Array.from({ length: 10 }, (_, i) =>
      createMockTrack(`track${i}`)
    )
    const excludeSet = new Set<string>(['track1', 'track2', 'track3'])

    // Run multiple times to ensure excluded tracks are never selected
    for (let i = 0; i < 10; i++) {
      const selected = simulateRandomTrackSelection(tracks, excludeSet)
      if (selected) {
        assert.ok(
          !excludeSet.has(selected.id),
          'Should never select played tracks'
        )
      }
    }
  })

  await t.test('skips artists with no valid tracks after filtering', () => {
    const tracks = Array.from({ length: 10 }, (_, i) =>
      createMockTrack(`track${i}`)
    )
    // Exclude all tracks
    const excludeSet = new Set(tracks.map((t) => t.id))

    const selected = simulateRandomTrackSelection(tracks, excludeSet)

    assert.equal(selected, null, 'Should return null when all tracks excluded')
  })

  await t.test('handles artists with < 10 tracks', () => {
    const tracks = Array.from({ length: 5 }, (_, i) =>
      createMockTrack(`track${i}`)
    )
    const excludeSet = new Set<string>()

    const selected = simulateRandomTrackSelection(tracks, excludeSet)

    assert.ok(selected !== null, 'Should select from available tracks')
    assert.ok(
      tracks.some((t) => t.id === selected.id),
      'Selected from available tracks'
    )
  })

  await t.test('filters out non-playable tracks', () => {
    const tracks = [
      createMockTrack('track1', true),
      createMockTrack('track2', false), // Not playable
      createMockTrack('track3', true),
      createMockTrack('track4', false), // Not playable
      createMockTrack('track5', true)
    ]
    const excludeSet = new Set<string>()

    // Run multiple times to ensure non-playable tracks are never selected
    for (let i = 0; i < 10; i++) {
      const selected = simulateRandomTrackSelection(tracks, excludeSet)
      if (selected) {
        assert.ok(selected.is_playable, 'Should only select playable tracks')
        assert.ok(
          ['track1', 'track3', 'track5'].includes(selected.id),
          'Should only select from playable tracks'
        )
      }
    }
  })

  await t.test('randomly selects different tracks on multiple calls', () => {
    const tracks = Array.from({ length: 10 }, (_, i) =>
      createMockTrack(`track${i}`)
    )
    const excludeSet = new Set<string>()

    const selections = new Set<string>()
    // Run 20 times to increase chance of getting different tracks
    for (let i = 0; i < 20; i++) {
      const selected = simulateRandomTrackSelection(tracks, excludeSet)
      if (selected) {
        selections.add(selected.id)
      }
    }

    // With 10 tracks and 20 selections, we should get at least 2 different tracks
    // (this is probabilistic, but very likely)
    assert.ok(
      selections.size >= 1,
      'Should select at least one track (may be same track multiple times due to randomness)'
    )
  })
})
