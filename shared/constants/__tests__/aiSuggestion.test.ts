// Feature: ai-song-suggestions, Property 4: Active prompt derivation from preset and custom prompt
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import { deriveActivePrompt, PRESET_PROMPTS } from '../aiSuggestion'

const PBT_CONFIG = { numRuns: 100 }

// Arbitrary that generates a valid preset ID from the 11 presets
const presetIdArb = fc.constantFrom(...PRESET_PROMPTS.map((p) => p.id))

// Arbitrary for non-empty-after-trim custom prompts
const nonEmptyCustomPromptArb = fc
  .string({ minLength: 1, maxLength: 500 })
  .filter((s) => s.trim().length > 0)

// Arbitrary for whitespace-only strings (empty after trim)
const whitespaceOnlyArb = fc.constantFrom('', ' ', '  ', '\t', '\n', '  \t\n  ')

describe('Property 4: Active prompt derivation from preset and custom prompt', () => {
  // **Validates: Requirements 2.2, 3.2, 3.3**

  it('returns trimmed custom prompt when custom prompt is non-empty after trimming', () => {
    fc.assert(
      fc.property(
        presetIdArb,
        nonEmptyCustomPromptArb,
        (presetId, customPrompt) => {
          const result = deriveActivePrompt(presetId, customPrompt)
          assert.equal(result, customPrompt.trim())
        }
      ),
      PBT_CONFIG
    )
  })

  it('returns preset prompt text when custom prompt is empty or whitespace-only', () => {
    fc.assert(
      fc.property(
        presetIdArb,
        whitespaceOnlyArb,
        (presetId, customPrompt) => {
          const result = deriveActivePrompt(presetId, customPrompt)
          const expectedPreset = PRESET_PROMPTS.find((p) => p.id === presetId)!
          assert.equal(result, expectedPreset.prompt)
        }
      ),
      PBT_CONFIG
    )
  })

  it('returns empty string when no preset selected and custom prompt is empty', () => {
    fc.assert(
      fc.property(
        whitespaceOnlyArb,
        (customPrompt) => {
          const result = deriveActivePrompt(null, customPrompt)
          assert.equal(result, '')
        }
      ),
      PBT_CONFIG
    )
  })

  it('custom prompt always takes precedence over preset for any preset ID', () => {
    fc.assert(
      fc.property(
        fc.oneof(presetIdArb, fc.constant(null)),
        nonEmptyCustomPromptArb,
        (presetId, customPrompt) => {
          const result = deriveActivePrompt(presetId, customPrompt)
          assert.equal(result, customPrompt.trim())
        }
      ),
      PBT_CONFIG
    )
  })

  it('reverts to preset prompt when custom prompt is cleared', () => {
    fc.assert(
      fc.property(
        presetIdArb,
        nonEmptyCustomPromptArb,
        (presetId, customPrompt) => {
          // First set a custom prompt
          const withCustom = deriveActivePrompt(presetId, customPrompt)
          assert.equal(withCustom, customPrompt.trim())

          // Then clear it
          const afterClear = deriveActivePrompt(presetId, '')
          const expectedPreset = PRESET_PROMPTS.find((p) => p.id === presetId)!
          assert.equal(afterClear, expectedPreset.prompt)
        }
      ),
      PBT_CONFIG
    )
  })
})

// Feature: ai-song-suggestions, Property 6: Custom prompt truncation at 500 characters
import { truncatePrompt, MAX_CUSTOM_PROMPT_LENGTH } from '../aiSuggestion'

describe('Property 6: Custom prompt truncation at 500 characters', () => {
  // **Validates: Requirements 3.5**

  it('returns a string of exactly 500 characters equal to the first 500 characters for strings longer than 500', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: MAX_CUSTOM_PROMPT_LENGTH + 1, maxLength: 2000 }),
        (input) => {
          const result = truncatePrompt(input)
          assert.equal(result.length, MAX_CUSTOM_PROMPT_LENGTH)
          assert.equal(result, input.slice(0, MAX_CUSTOM_PROMPT_LENGTH))
        }
      ),
      PBT_CONFIG
    )
  })

  it('returns the string unchanged for strings of length <= 500', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: MAX_CUSTOM_PROMPT_LENGTH }),
        (input) => {
          const result = truncatePrompt(input)
          assert.equal(result, input)
        }
      ),
      PBT_CONFIG
    )
  })

  it('returns exactly 500 characters for strings of exactly 501 characters', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: MAX_CUSTOM_PROMPT_LENGTH + 1, maxLength: MAX_CUSTOM_PROMPT_LENGTH + 1 }),
        (input) => {
          const result = truncatePrompt(input)
          assert.equal(result.length, MAX_CUSTOM_PROMPT_LENGTH)
          assert.equal(result, input.slice(0, MAX_CUSTOM_PROMPT_LENGTH))
        }
      ),
      PBT_CONFIG
    )
  })

  it('returns the string unchanged for strings of exactly 500 characters', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: MAX_CUSTOM_PROMPT_LENGTH, maxLength: MAX_CUSTOM_PROMPT_LENGTH }),
        (input) => {
          const result = truncatePrompt(input)
          assert.equal(result, input)
          assert.equal(result.length, MAX_CUSTOM_PROMPT_LENGTH)
        }
      ),
      PBT_CONFIG
    )
  })
})

// Feature: ai-song-suggestions, Property 5: Suggestion state localStorage round-trip
// Uses PRESET_PROMPTS, MAX_CUSTOM_PROMPT_LENGTH already imported above
// Uses AiSuggestionsState type from shared/types
import type { AiSuggestionsState } from '@/shared/types/aiSuggestions'

const presetIdOrNullArb = fc.oneof(
  fc.constantFrom(...PRESET_PROMPTS.map((p) => p.id)),
  fc.constant(null)
)

const customPromptArb = fc.string({ minLength: 0, maxLength: MAX_CUSTOM_PROMPT_LENGTH })

const autoFillTargetSizeArb = fc.integer({ min: 1, max: 1000 })

const aiSuggestionsStateArb = fc.record({
  selectedPresetId: presetIdOrNullArb,
  customPrompt: customPromptArb,
  autoFillTargetSize: autoFillTargetSizeArb
}) as fc.Arbitrary<AiSuggestionsState>

describe('Property 5: Suggestion state localStorage round-trip', () => {
  // **Validates: Requirements 2.4, 3.4, 8.2, 8.3**

  it('JSON round-trip produces an object equal to the original state', () => {
    fc.assert(
      fc.property(
        aiSuggestionsStateArb,
        (state) => {
          const plain: AiSuggestionsState = {
            selectedPresetId: state.selectedPresetId,
            customPrompt: state.customPrompt,
            autoFillTargetSize: state.autoFillTargetSize
          }
          const roundTripped = JSON.parse(JSON.stringify(plain)) as AiSuggestionsState
          assert.deepStrictEqual(roundTripped, plain)
        }
      ),
      PBT_CONFIG
    )
  })

  it('round-tripped state preserves selectedPresetId type (string or null)', () => {
    fc.assert(
      fc.property(
        aiSuggestionsStateArb,
        (state) => {
          const plain: AiSuggestionsState = {
            selectedPresetId: state.selectedPresetId,
            customPrompt: state.customPrompt,
            autoFillTargetSize: state.autoFillTargetSize
          }
          const roundTripped = JSON.parse(JSON.stringify(plain)) as AiSuggestionsState
          if (plain.selectedPresetId === null) {
            assert.equal(roundTripped.selectedPresetId, null)
          } else {
            assert.equal(typeof roundTripped.selectedPresetId, 'string')
            assert.equal(roundTripped.selectedPresetId, plain.selectedPresetId)
          }
        }
      ),
      PBT_CONFIG
    )
  })

  it('round-tripped state preserves customPrompt as a string of the same length', () => {
    fc.assert(
      fc.property(
        aiSuggestionsStateArb,
        (state) => {
          const plain: AiSuggestionsState = {
            selectedPresetId: state.selectedPresetId,
            customPrompt: state.customPrompt,
            autoFillTargetSize: state.autoFillTargetSize
          }
          const roundTripped = JSON.parse(JSON.stringify(plain)) as AiSuggestionsState
          assert.equal(typeof roundTripped.customPrompt, 'string')
          assert.equal(roundTripped.customPrompt.length, plain.customPrompt.length)
          assert.equal(roundTripped.customPrompt, plain.customPrompt)
        }
      ),
      PBT_CONFIG
    )
  })

  it('round-tripped state preserves autoFillTargetSize as an integer', () => {
    fc.assert(
      fc.property(
        aiSuggestionsStateArb,
        (state) => {
          const plain: AiSuggestionsState = {
            selectedPresetId: state.selectedPresetId,
            customPrompt: state.customPrompt,
            autoFillTargetSize: state.autoFillTargetSize
          }
          const roundTripped = JSON.parse(JSON.stringify(plain)) as AiSuggestionsState
          assert.equal(typeof roundTripped.autoFillTargetSize, 'number')
          assert.equal(Number.isInteger(roundTripped.autoFillTargetSize), true)
          assert.equal(roundTripped.autoFillTargetSize, plain.autoFillTargetSize)
        }
      ),
      PBT_CONFIG
    )
  })
})
