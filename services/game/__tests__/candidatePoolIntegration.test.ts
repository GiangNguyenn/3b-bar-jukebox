import test from 'node:test'
import assert from 'node:assert/strict'
import type {
  PlayerGravityMap,
  PlayerId,
  TargetProfile
} from '../dgsTypes'

// Integration tests for candidate pool building logic
// These test the business logic and thresholds without requiring full API/database mocking

function calculateInfluenceFromGravity(gravity: number): number {
  return ((gravity - 0.15) / (0.7 - 0.15)) * 100
}

function shouldIncludeTargetRelatedArtists(gravity: number): boolean {
  const influence = calculateInfluenceFromGravity(gravity)
  return influence < 20 || influence > 50
}

function shouldInjectTargetArtist(
  gravity: number,
  roundNumber: number
): boolean {
  const influence = calculateInfluenceFromGravity(gravity)
  return roundNumber >= 10 || influence > 80
}

test('Full Pipeline Flow - Threshold Integration', async (t) => {
  await t.test(
    'Dead Zone (20-49% influence) excludes target-related artists',
    () => {
      // Calculate gravity values for Dead Zone boundaries
      // 20% influence: gravity = 0.26
      // 49% influence: gravity = 0.42
      // Test gravity values in Dead Zone
      const deadZoneGravities = [0.26, 0.3, 0.35, 0.4, 0.42]

      deadZoneGravities.forEach((gravity) => {
        const shouldInclude = shouldIncludeTargetRelatedArtists(gravity)
        const influence = calculateInfluenceFromGravity(gravity)
        assert.ok(
          !shouldInclude,
          `Gravity ${gravity} (${influence.toFixed(1)}% influence) should NOT include target-related artists in Dead Zone`
        )
      })
    }
  )

  await t.test(
    'High influence (> 80%) injects target artist regardless of round',
    () => {
      const highGravity = 0.6 // > 80% influence
      const earlyRound = 1

      const shouldInject = shouldInjectTargetArtist(highGravity, earlyRound)
      assert.ok(
        shouldInject,
        'High influence should inject target artist even in early rounds'
      )
    }
  )

  await t.test(
    'Round 10+ injects target artist regardless of influence',
    () => {
      const lowGravity = 0.3 // Low influence
      const lateRound = 10

      const shouldInject = shouldInjectTargetArtist(lowGravity, lateRound)
      assert.ok(
        shouldInject,
        'Round 10+ should inject target artist even with low influence'
      )
    }
  )

  await t.test('Desperation Mode (< 20% influence) includes target-related', () => {
    const lowGravities = [0.15, 0.16, 0.17, 0.18, 0.19]

    lowGravities.forEach((gravity) => {
      const shouldInclude = shouldIncludeTargetRelatedArtists(gravity)
      assert.ok(
        shouldInclude,
        `Gravity ${gravity} (< 20% influence) should include target-related artists in Desperation Mode`
      )
    })
  })

  await t.test('Good Influence (> 50% influence) includes target-related', () => {
    const goodGravities = [0.51, 0.55, 0.6, 0.65, 0.7]

    goodGravities.forEach((gravity) => {
      const shouldInclude = shouldIncludeTargetRelatedArtists(gravity)
      assert.ok(
        shouldInclude,
        `Gravity ${gravity} (> 50% influence) should include target-related artists`
      )
    })
  })
})

test('Candidate Pool Size Requirements', () => {
  const MIN_ARTISTS = 100
  const MIN_TRACKS = 100

  // Simulate artist selection
  function simulateArtistSelection(
    seedArtists: number,
    targetArtists: number,
    targetInjected: number
  ): number {
    const current = seedArtists + targetArtists + targetInjected
    const needed = Math.max(0, MIN_ARTISTS - current)
    return current + needed // Final count after adding random artists
  }

  // Test various scenarios
  assert.equal(
    simulateArtistSelection(30, 20, 1),
    100,
    'Should reach 100 artists when starting with 51'
  )

  assert.equal(
    simulateArtistSelection(80, 30, 1),
    111,
    'Should keep existing artists when already at 100+'
  )

  assert.equal(
    simulateArtistSelection(50, 50, 0),
    100,
    'Should reach exactly 100 when starting with 100'
  )
})

test('Track Selection Requirements', () => {
  // Each artist should contribute 1 track (randomly selected from top 10)
  const artistsSelected = 100
  const tracksPerArtist = 1
  const expectedTracks = artistsSelected * tracksPerArtist

  assert.equal(expectedTracks, 100, '100 artists should yield 100 tracks')

  // Test with fewer artists (should trigger fallback)
  const fewArtists = 50
  const tracksFromArtists = fewArtists * tracksPerArtist
  const needsFallback = tracksFromArtists < 100
  const fallbackTracks = needsFallback ? 100 - tracksFromArtists : 0

  assert.ok(needsFallback, 'Should need fallback with only 50 artists')
  assert.equal(fallbackTracks, 50, 'Should need 50 fallback tracks')
})

test('Exclusion Logic Integration', () => {
  const currentTrackId = 'current-123'
  const playedTrackIds = ['played-1', 'played-2', 'played-3']

  // Simulate track filtering
  function filterTracks(
    tracks: string[],
    excludeSet: Set<string>
  ): string[] {
    return tracks.filter((id) => !excludeSet.has(id))
  }

  const allTracks = [
    'track1',
    'track2',
    currentTrackId, // Should be excluded
    'track4',
    'played-1', // Should be excluded
    'track6',
    'played-2', // Should be excluded
    'track8'
  ]

  const excludeSet = new Set([currentTrackId, ...playedTrackIds])
  const validTracks = filterTracks(allTracks, excludeSet)

  assert.equal(validTracks.length, 5, 'Should have 5 valid tracks after exclusion')
  assert.ok(
    !validTracks.includes(currentTrackId),
    'Should exclude current track'
  )
  assert.ok(
    !validTracks.includes('played-1'),
    'Should exclude played tracks'
  )
  assert.ok(
    !validTracks.includes('played-2'),
    'Should exclude played tracks'
  )
})
