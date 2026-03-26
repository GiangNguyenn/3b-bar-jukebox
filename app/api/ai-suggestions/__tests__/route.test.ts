// Feature: ai-song-suggestions, Property 13: API request validation accepts valid and rejects invalid inputs

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import { aiSuggestionsRequestSchema } from '../route'

const PBT_CONFIG = { numRuns: 100 }

// --- Shared arbitraries ---

const validPromptArb = fc
  .string({ minLength: 1, maxLength: 500 })
  .filter((s) => s.trim().length > 0)
  .map((s) => s.trim())

const validProfileIdArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0)
  .map((s) => s.trim())

const validExcludedTrackIdsArb = fc.array(
  fc.string({ minLength: 0, maxLength: 50 }),
  { minLength: 0, maxLength: 20 }
)

void describe('Property 13: API request validation accepts valid and rejects invalid inputs', () => {
  // **Validates: Requirements 7.1, 7.2, 7.4**

  void it('accepts valid inputs with non-empty prompt (1-500 chars), valid profileId, and string array excludedTrackIds', () => {
    fc.assert(
      fc.property(
        validPromptArb,
        validProfileIdArb,
        validExcludedTrackIdsArb,
        (prompt, profileId, excludedTrackIds) => {
          const result = aiSuggestionsRequestSchema.safeParse({
            prompt,
            profileId,
            excludedTrackIds
          })
          assert.equal(
            result.success,
            true,
            `should accept valid input: prompt="${prompt}", profileId="${profileId}"`
          )
        }
      ),
      PBT_CONFIG
    )
  })

  void it('rejects when prompt is empty string', () => {
    fc.assert(
      fc.property(
        validProfileIdArb,
        validExcludedTrackIdsArb,
        (profileId, excludedTrackIds) => {
          const result = aiSuggestionsRequestSchema.safeParse({
            prompt: '',
            profileId,
            excludedTrackIds
          })
          assert.equal(result.success, false, 'should reject empty prompt')
        }
      ),
      PBT_CONFIG
    )
  })

  void it('rejects when prompt exceeds 500 characters', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 501, maxLength: 1000 }),
        validProfileIdArb,
        validExcludedTrackIdsArb,
        (prompt, profileId, excludedTrackIds) => {
          const result = aiSuggestionsRequestSchema.safeParse({
            prompt,
            profileId,
            excludedTrackIds
          })
          assert.equal(
            result.success,
            false,
            'should reject prompt longer than 500 chars'
          )
        }
      ),
      PBT_CONFIG
    )
  })

  void it('rejects when prompt is missing or not a string', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(undefined),
          fc.constant(null),
          fc.integer(),
          fc.boolean(),
          fc.constant([]),
          fc.constant({})
        ),
        validProfileIdArb,
        validExcludedTrackIdsArb,
        (prompt, profileId, excludedTrackIds) => {
          const result = aiSuggestionsRequestSchema.safeParse({
            prompt,
            profileId,
            excludedTrackIds
          })
          assert.equal(
            result.success,
            false,
            `should reject non-string prompt: ${typeof prompt}`
          )
        }
      ),
      PBT_CONFIG
    )
  })

  void it('rejects when excludedTrackIds is not an array of strings', () => {
    fc.assert(
      fc.property(
        validPromptArb,
        validProfileIdArb,
        fc.oneof(
          fc.constant('not-an-array'),
          fc.integer(),
          fc.boolean(),
          fc.constant(null),
          fc.array(fc.integer(), { minLength: 1, maxLength: 5 }),
          fc.array(fc.boolean(), { minLength: 1, maxLength: 5 })
        ),
        (prompt, profileId, excludedTrackIds) => {
          const result = aiSuggestionsRequestSchema.safeParse({
            prompt,
            profileId,
            excludedTrackIds
          })
          assert.equal(
            result.success,
            false,
            `should reject invalid excludedTrackIds: ${JSON.stringify(excludedTrackIds)}`
          )
        }
      ),
      PBT_CONFIG
    )
  })

  void it('rejects when profileId is missing or empty', () => {
    fc.assert(
      fc.property(
        validPromptArb,
        fc.oneof(
          fc.constant(undefined),
          fc.constant(null),
          fc.constant(''),
          fc.integer(),
          fc.boolean()
        ),
        validExcludedTrackIdsArb,
        (prompt, profileId, excludedTrackIds) => {
          const result = aiSuggestionsRequestSchema.safeParse({
            prompt,
            profileId,
            excludedTrackIds
          })
          assert.equal(
            result.success,
            false,
            `should reject invalid profileId: ${JSON.stringify(profileId)}`
          )
        }
      ),
      PBT_CONFIG
    )
  })
})
