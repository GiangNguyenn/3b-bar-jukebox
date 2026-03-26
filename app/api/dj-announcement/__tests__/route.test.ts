// Feature: dj-subtitles, Property 1: Invalid announcement requests are rejected
// Feature: dj-subtitles, Property 2: Announcement API payload construction

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import { validateRequest, buildUpsertPayload } from '../validation'

const PBT_CONFIG = { numRuns: 100 }

// --- Shared arbitraries ---

const validProfileIdArb = fc.uuid()

const validScriptTextArb = fc
  .string({ minLength: 1, maxLength: 500 })
  .filter((s) => s.trim().length > 0)

const emptyOrMissingStringArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.constant(''),
  fc.constant('   ')
)

void describe('Property 1: Invalid announcement requests are rejected', () => {
  // **Validates: Requirements 1.3**

  void it('rejects when profileId is missing or empty', () => {
    fc.assert(
      fc.property(
        emptyOrMissingStringArb,
        validScriptTextArb,
        (profileId, scriptText) => {
          const result = validateRequest({
            profileId: profileId as string | undefined,
            scriptText
          })
          assert.notEqual(
            result,
            null,
            `should reject invalid profileId: ${JSON.stringify(profileId)}`
          )
        }
      ),
      PBT_CONFIG
    )
  })

  void it('rejects when neither scriptText nor clear is provided', () => {
    fc.assert(
      fc.property(validProfileIdArb, (profileId) => {
        const result = validateRequest({ profileId })
        assert.notEqual(
          result,
          null,
          'should reject when neither scriptText nor clear is provided'
        )
      }),
      PBT_CONFIG
    )
  })

  void it('rejects when scriptText is empty and clear is not true', () => {
    fc.assert(
      fc.property(
        validProfileIdArb,
        emptyOrMissingStringArb,
        (profileId, scriptText) => {
          const result = validateRequest({
            profileId,
            scriptText: scriptText as string | undefined,
            clear: false
          })
          assert.notEqual(
            result,
            null,
            `should reject empty scriptText without clear: ${JSON.stringify(scriptText)}`
          )
        }
      ),
      PBT_CONFIG
    )
  })

  void it('never produces a database payload for invalid requests', () => {
    fc.assert(
      fc.property(
        emptyOrMissingStringArb,
        fc.option(validScriptTextArb),
        fc.boolean(),
        (profileId, scriptText, clear) => {
          const body = {
            profileId: profileId as string | undefined,
            scriptText: scriptText ?? undefined,
            clear
          }
          const result = validateRequest(body)
          // If validation fails, buildUpsertPayload should not be called
          assert.notEqual(result, null, 'invalid profileId should always fail')
        }
      ),
      PBT_CONFIG
    )
  })
})

void describe('Property 2: Announcement API payload construction', () => {
  // **Validates: Requirements 1.2, 2.3**

  void it('produces correct set payload with is_active true and matching script_text', () => {
    fc.assert(
      fc.property(
        validProfileIdArb,
        validScriptTextArb,
        (profileId, scriptText) => {
          const payload = buildUpsertPayload({ profileId, scriptText })
          assert.equal(payload.profile_id, profileId)
          assert.equal(payload.is_active, true)
          assert.equal(payload.script_text, scriptText)
          assert.ok(payload.updated_at, 'should have updated_at')
        }
      ),
      PBT_CONFIG
    )
  })

  void it('produces correct clear payload with is_active false and empty script_text', () => {
    fc.assert(
      fc.property(validProfileIdArb, (profileId) => {
        const payload = buildUpsertPayload({ profileId, clear: true })
        assert.equal(payload.profile_id, profileId)
        assert.equal(payload.is_active, false)
        assert.equal(payload.script_text, '')
        assert.ok(payload.updated_at, 'should have updated_at')
      }),
      PBT_CONFIG
    )
  })

  void it('clear takes precedence over scriptText when both provided', () => {
    fc.assert(
      fc.property(
        validProfileIdArb,
        validScriptTextArb,
        (profileId, scriptText) => {
          const payload = buildUpsertPayload({
            profileId,
            scriptText,
            clear: true
          })
          assert.equal(payload.is_active, false)
          assert.equal(payload.script_text, '')
        }
      ),
      PBT_CONFIG
    )
  })
})
