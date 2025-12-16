import test from 'node:test'
import assert from 'node:assert/strict'

// Test the logic for Stage 1 artist selection
// Note: Full integration tests would require mocking:
// - Supabase client (for fetchRandomArtistsFromDb)
// - Spotify API (for getSeedRelatedArtists, resolveTargetProfiles)
// - Next.js request/response objects

function calculateInfluenceFromGravity(gravity: number): number {
  // 80% influence = ((gravity - 0.15) / (0.7 - 0.15)) * 100 = 80
  // Solving: gravity = 0.59
  return ((gravity - 0.15) / (0.7 - 0.15)) * 100
}

function shouldIncludeTargetRelatedArtists(gravity: number): boolean {
  // Include when: influence < 20% OR influence > 50%
  // NOT included in Dead Zone (20-49% influence)
  const influence = calculateInfluenceFromGravity(gravity)
  return influence < 20 || influence > 50
}

function shouldInjectTargetArtist(
  gravity: number,
  roundNumber: number
): boolean {
  // Inject when: Round >= 10 OR influence > 80% (gravity > 0.59)
  const influence = calculateInfluenceFromGravity(gravity)
  return roundNumber >= 10 || influence > 80
}

void test('Target-Related Artist Seeding Logic', async (t) => {
  await t.test(
    'includes target-related artists when influence < 20% (Desperation Mode)',
    () => {
      // Gravity < 0.2 = influence < 20%
      assert.ok(shouldIncludeTargetRelatedArtists(0.15), 'Gravity 0.15 should include')
      assert.ok(shouldIncludeTargetRelatedArtists(0.19), 'Gravity 0.19 should include')
    }
  )

  await t.test(
    'skips target-related artists in Dead Zone (20-49% influence)',
    () => {
      // Calculate gravity values for 20% and 49% influence
      // 20% influence: ((gravity - 0.15) / 0.55) * 100 = 20 => gravity = 0.26
      // 49% influence: ((gravity - 0.15) / 0.55) * 100 = 49 => gravity = 0.4195
      // Dead Zone: gravity 0.26 to 0.42 (approximately)
      assert.ok(
        !shouldIncludeTargetRelatedArtists(0.26),
        'Gravity 0.26 (20% influence) should NOT include'
      )
      assert.ok(
        !shouldIncludeTargetRelatedArtists(0.3),
        'Gravity 0.3 (27% influence) should NOT include'
      )
      assert.ok(
        !shouldIncludeTargetRelatedArtists(0.42),
        'Gravity 0.42 (49% influence) should NOT include'
      )
    }
  )

  await t.test(
    'includes target-related artists when influence > 50% (Good Influence)',
    () => {
      // Gravity > 0.5 = influence > 50%
      assert.ok(
        shouldIncludeTargetRelatedArtists(0.51),
        'Gravity 0.51 (65% influence) should include'
      )
      assert.ok(
        shouldIncludeTargetRelatedArtists(0.6),
        'Gravity 0.6 (82% influence) should include'
      )
      assert.ok(
        shouldIncludeTargetRelatedArtists(0.7),
        'Gravity 0.7 (100% influence) should include'
      )
    }
  )
})

void test('Target Artist Direct Injection Logic', async (t) => {
  await t.test('injects target artist when Round >= 10', () => {
    assert.ok(
      shouldInjectTargetArtist(0.3, 10),
      'Round 10 with low gravity should inject'
    )
    assert.ok(
      shouldInjectTargetArtist(0.3, 15),
      'Round 15 with low gravity should inject'
    )
  })

  await t.test(
    'injects target artist when gravity > 0.59 (80% influence)',
    () => {
      assert.ok(
        shouldInjectTargetArtist(0.6, 1),
        'Gravity 0.6 (> 80% influence) in early round should inject'
      )
      assert.ok(
        shouldInjectTargetArtist(0.65, 5),
        'Gravity 0.65 (> 80% influence) in round 5 should inject'
      )
    }
  )

  await t.test(
    'does NOT inject when Round < 10 AND gravity <= 0.59',
    () => {
      assert.ok(
        !shouldInjectTargetArtist(0.3, 9),
        'Round 9 with low gravity should NOT inject'
      )
      assert.ok(
        !shouldInjectTargetArtist(0.59, 9),
        'Round 9 with gravity 0.59 should NOT inject (threshold is > 0.59)'
      )
      assert.ok(
        !shouldInjectTargetArtist(0.58, 9),
        'Round 9 with gravity 0.58 should NOT inject'
      )
    }
  )

  await t.test('injects when either condition is met', () => {
    // Round >= 10
    assert.ok(
      shouldInjectTargetArtist(0.3, 10),
      'Round 10 should inject regardless of gravity'
    )
    // Gravity > 0.59
    assert.ok(
      shouldInjectTargetArtist(0.6, 5),
      'High gravity should inject regardless of round'
    )
    // Both conditions
    assert.ok(
      shouldInjectTargetArtist(0.6, 10),
      'Both conditions met should inject'
    )
  })
})

void test('Influence to Gravity Conversion', () => {
  // Test the conversion formula: influence% = ((gravity - 0.15) / (0.7 - 0.15)) * 100
  assert.equal(calculateInfluenceFromGravity(0.15), 0, 'Gravity 0.15 = 0% influence')
  assert.equal(calculateInfluenceFromGravity(0.7), 100, 'Gravity 0.7 = 100% influence')
  
  // 80% influence calculation
  const gravityFor80Percent = 0.59
  const calculatedInfluence = calculateInfluenceFromGravity(gravityFor80Percent)
  assert.ok(
    Math.abs(calculatedInfluence - 80) < 0.1,
    `Gravity 0.59 should be approximately 80% influence, got ${calculatedInfluence}`
  )
})

void test('Random Artist Selection Requirements', () => {
  // Test that we understand the minimum requirement
  const MIN_TOTAL_ARTISTS = 100

  // Simulate scenarios
  const seedArtists = 30
  const targetArtists = 20
  const targetInjected = 1
  const currentCount = seedArtists + targetArtists + targetInjected
  const neededRandom = Math.max(0, MIN_TOTAL_ARTISTS - currentCount)

  assert.equal(neededRandom, 49, 'Should need 49 random artists to reach 100')

  // Test when we already have enough
  const manySeedArtists = 80
  const manyTargetArtists = 30
  const manyCurrentCount = manySeedArtists + manyTargetArtists + targetInjected
  const manyNeededRandom = Math.max(0, MIN_TOTAL_ARTISTS - manyCurrentCount)

  assert.equal(manyNeededRandom, 0, 'Should not need random artists when already at 100+')
})
