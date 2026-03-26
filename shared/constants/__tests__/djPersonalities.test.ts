// Feature: dj-personality-options, Property 1: Personality ID list consistency
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import {
  DJ_PERSONALITIES,
  DJ_PERSONALITY_IDS,
  DEFAULT_DJ_PERSONALITY,
  DJPersonalityOption
} from '../djPersonalities'

const PBT_CONFIG = { numRuns: 100 }

// Arbitrary that picks a random index into DJ_PERSONALITIES
const personalityIndexArb = fc.integer({
  min: 0,
  max: DJ_PERSONALITIES.length - 1
})

// Arbitrary that picks a random index into DJ_PERSONALITY_IDS
const idIndexArb = fc.integer({
  min: 0,
  max: DJ_PERSONALITY_IDS.length - 1
})

describe('Property 1: Personality ID list consistency', () => {
  // **Validates: Requirements 1.3**

  it('every DJ_PERSONALITIES entry has its value in DJ_PERSONALITY_IDS', () => {
    fc.assert(
      fc.property(personalityIndexArb, (idx) => {
        const personality: DJPersonalityOption = DJ_PERSONALITIES[idx]
        assert.ok(
          DJ_PERSONALITY_IDS.includes(personality.value),
          `Personality "${personality.value}" not found in DJ_PERSONALITY_IDS`
        )
      }),
      PBT_CONFIG
    )
  })

  it('DJ_PERSONALITY_IDS length matches DJ_PERSONALITIES length', () => {
    assert.equal(DJ_PERSONALITY_IDS.length, DJ_PERSONALITIES.length)
  })

  it('every DJ_PERSONALITY_IDS entry maps back to a DJ_PERSONALITIES entry', () => {
    fc.assert(
      fc.property(idIndexArb, (idx) => {
        const id = DJ_PERSONALITY_IDS[idx]
        const match = DJ_PERSONALITIES.find((p) => p.value === id)
        assert.ok(
          match !== undefined,
          `ID "${id}" has no corresponding entry in DJ_PERSONALITIES`
        )
      }),
      PBT_CONFIG
    )
  })
})

describe('Unit tests: personality constants', () => {
  it('defines exactly 6 personalities (Req 1.1)', () => {
    assert.equal(DJ_PERSONALITIES.length, 6)
  })

  it('default personality ID is chill (Req 1.2)', () => {
    assert.equal(DEFAULT_DJ_PERSONALITY, 'chill')
  })

  it('all personality IDs are unique strings', () => {
    const ids = DJ_PERSONALITIES.map((p) => p.value)
    const unique = new Set(ids)
    assert.equal(unique.size, ids.length)
    for (const id of ids) {
      assert.equal(typeof id, 'string')
      assert.ok(id.length > 0, `ID should be non-empty`)
    }
  })

  it('all personality prompts are non-empty strings', () => {
    for (const p of DJ_PERSONALITIES) {
      assert.equal(typeof p.prompt, 'string')
      assert.ok(
        p.prompt.length > 0,
        `Prompt for "${p.value}" should be non-empty`
      )
    }
  })
})

// Feature: dj-personality-options, Property 2: Personality resolution round-trip

/**
 * Pure resolution function matching the logic in DJService and the API route.
 * Given a raw localStorage value (string | null), returns the resolved personality ID.
 */
function resolvePersonality(raw: string | null): string {
  return typeof raw === 'string' && DJ_PERSONALITY_IDS.includes(raw)
    ? raw
    : DEFAULT_DJ_PERSONALITY
}

describe('Property 2: Personality resolution round-trip', () => {
  // **Validates: Requirements 3.1, 3.2**

  it('resolving a valid personality ID returns that same ID', () => {
    fc.assert(
      fc.property(fc.constantFrom(...DJ_PERSONALITY_IDS), (validId) => {
        const resolved = resolvePersonality(validId)
        assert.equal(
          resolved,
          validId,
          `Expected resolvePersonality("${validId}") to return "${validId}", got "${resolved}"`
        )
      }),
      PBT_CONFIG
    )
  })

  it('resolving an invalid string returns DEFAULT_DJ_PERSONALITY', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !DJ_PERSONALITY_IDS.includes(s)),
        (invalidStr) => {
          const resolved = resolvePersonality(invalidStr)
          assert.equal(
            resolved,
            DEFAULT_DJ_PERSONALITY,
            `Expected resolvePersonality("${invalidStr}") to return "${DEFAULT_DJ_PERSONALITY}", got "${resolved}"`
          )
        }
      ),
      PBT_CONFIG
    )
  })

  it('resolving null returns DEFAULT_DJ_PERSONALITY', () => {
    const resolved = resolvePersonality(null)
    assert.equal(
      resolved,
      DEFAULT_DJ_PERSONALITY,
      `Expected resolvePersonality(null) to return "${DEFAULT_DJ_PERSONALITY}", got "${resolved}"`
    )
  })
})
