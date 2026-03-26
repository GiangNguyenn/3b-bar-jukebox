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
      fc.property(presetIdArb, whitespaceOnlyArb, (presetId, customPrompt) => {
        const result = deriveActivePrompt(presetId, customPrompt)
        const expectedPreset = PRESET_PROMPTS.find((p) => p.id === presetId)!
        assert.equal(result, expectedPreset.prompt)
      }),
      PBT_CONFIG
    )
  })

  it('returns empty string when no preset selected and custom prompt is empty', () => {
    fc.assert(
      fc.property(whitespaceOnlyArb, (customPrompt) => {
        const result = deriveActivePrompt(null, customPrompt)
        assert.equal(result, '')
      }),
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
        fc.string({
          minLength: MAX_CUSTOM_PROMPT_LENGTH + 1,
          maxLength: MAX_CUSTOM_PROMPT_LENGTH + 1
        }),
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
        fc.string({
          minLength: MAX_CUSTOM_PROMPT_LENGTH,
          maxLength: MAX_CUSTOM_PROMPT_LENGTH
        }),
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

const customPromptArb = fc.string({
  minLength: 0,
  maxLength: MAX_CUSTOM_PROMPT_LENGTH
})

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
      fc.property(aiSuggestionsStateArb, (state) => {
        const plain: AiSuggestionsState = {
          selectedPresetId: state.selectedPresetId,
          customPrompt: state.customPrompt,
          autoFillTargetSize: state.autoFillTargetSize
        }
        const roundTripped = JSON.parse(
          JSON.stringify(plain)
        ) as AiSuggestionsState
        assert.deepStrictEqual(roundTripped, plain)
      }),
      PBT_CONFIG
    )
  })

  it('round-tripped state preserves selectedPresetId type (string or null)', () => {
    fc.assert(
      fc.property(aiSuggestionsStateArb, (state) => {
        const plain: AiSuggestionsState = {
          selectedPresetId: state.selectedPresetId,
          customPrompt: state.customPrompt,
          autoFillTargetSize: state.autoFillTargetSize
        }
        const roundTripped = JSON.parse(
          JSON.stringify(plain)
        ) as AiSuggestionsState
        if (plain.selectedPresetId === null) {
          assert.equal(roundTripped.selectedPresetId, null)
        } else {
          assert.equal(typeof roundTripped.selectedPresetId, 'string')
          assert.equal(roundTripped.selectedPresetId, plain.selectedPresetId)
        }
      }),
      PBT_CONFIG
    )
  })

  it('round-tripped state preserves customPrompt as a string of the same length', () => {
    fc.assert(
      fc.property(aiSuggestionsStateArb, (state) => {
        const plain: AiSuggestionsState = {
          selectedPresetId: state.selectedPresetId,
          customPrompt: state.customPrompt,
          autoFillTargetSize: state.autoFillTargetSize
        }
        const roundTripped = JSON.parse(
          JSON.stringify(plain)
        ) as AiSuggestionsState
        assert.equal(typeof roundTripped.customPrompt, 'string')
        assert.equal(
          roundTripped.customPrompt.length,
          plain.customPrompt.length
        )
        assert.equal(roundTripped.customPrompt, plain.customPrompt)
      }),
      PBT_CONFIG
    )
  })

  it('round-tripped state preserves autoFillTargetSize as an integer', () => {
    fc.assert(
      fc.property(aiSuggestionsStateArb, (state) => {
        const plain: AiSuggestionsState = {
          selectedPresetId: state.selectedPresetId,
          customPrompt: state.customPrompt,
          autoFillTargetSize: state.autoFillTargetSize
        }
        const roundTripped = JSON.parse(
          JSON.stringify(plain)
        ) as AiSuggestionsState
        assert.equal(typeof roundTripped.autoFillTargetSize, 'number')
        assert.equal(Number.isInteger(roundTripped.autoFillTargetSize), true)
        assert.equal(roundTripped.autoFillTargetSize, plain.autoFillTargetSize)
      }),
      PBT_CONFIG
    )
  })
})

// Feature: drinking-anthems-preset, Unit tests for Drinking Anthems preset entry
describe('Drinking Anthems preset entry', () => {
  // **Validates: Requirements 1.1, 1.2, 2.1, 2.2, 2.3**

  it('has id "drinking-anthems" at index 0', () => {
    assert.equal(PRESET_PROMPTS[0].id, 'drinking-anthems')
  })

  it('has label "Drinking Anthems"', () => {
    assert.equal(PRESET_PROMPTS[0].label, 'Drinking Anthems')
  })

  it('has emoji 🍺', () => {
    assert.equal(PRESET_PROMPTS[0].emoji, '🍺')
  })

  it('prompt references beer, pubs, bars, and drinking culture', () => {
    const prompt = PRESET_PROMPTS[0].prompt.toLowerCase()
    assert.ok(prompt.includes('beer'), 'prompt should reference beer')
    assert.ok(prompt.includes('pub'), 'prompt should reference pubs')
    assert.ok(prompt.includes('bar'), 'prompt should reference bars')
    assert.ok(
      prompt.includes('drinking culture'),
      'prompt should reference drinking culture'
    )
  })

  it('PRESET_PROMPTS contains 12 presets', () => {
    assert.equal(PRESET_PROMPTS.length, 12)
  })

  it('default selectedPresetId equals "drinking-anthems" when no localStorage state exists', () => {
    // getInitialState uses PRESET_PROMPTS[0]?.id ?? null as the default
    const defaultPresetId = PRESET_PROMPTS[0]?.id ?? null
    assert.equal(defaultPresetId, 'drinking-anthems')
  })

  it('deriveActivePrompt("drinking-anthems", "") returns the drinking anthems prompt text', () => {
    const result = deriveActivePrompt('drinking-anthems', '')
    assert.equal(result, PRESET_PROMPTS[0].prompt)
  })
})

// Feature: drinking-anthems-preset, Property 1: Original presets preserved
describe('Property 1: Original presets preserved', () => {
  // **Validates: Requirements 3.2**

  // The 11 originally existing presets (now at indices 1–11)
  const originalPresets = [
    {
      id: 'party',
      label: 'Party',
      emoji: '🎉',
      prompt:
        'Upbeat, high-energy party songs that get people dancing. Mix of pop, dance, and hip hop hits.'
    },
    {
      id: 'chill',
      label: 'Chill',
      emoji: '☕',
      prompt:
        'Relaxed, mellow songs for a laid-back atmosphere. Lo-fi, acoustic, jazz, and soft indie.'
    },
    {
      id: 'rock',
      label: 'Rock',
      emoji: '🎸',
      prompt:
        'Rock classics and modern rock anthems. Alternative, indie rock, and classic rock.'
    },
    {
      id: 'throwback',
      label: 'Throwback',
      emoji: '📻',
      prompt:
        'Nostalgic hits from the 70s, 80s, and 90s. Classic soul, disco, new wave, and retro pop.'
    },
    {
      id: 'indie',
      label: 'Indie',
      emoji: '🎧',
      prompt:
        'Independent and alternative music. Indie pop, indie rock, dream pop, and shoegaze.'
    },
    {
      id: 'hiphop',
      label: 'Hip Hop',
      emoji: '🎤',
      prompt:
        'Hip hop and R&B tracks. Mix of classic boom bap, modern trap, and smooth R&B.'
    },
    {
      id: 'electronic',
      label: 'Electronic',
      emoji: '🎛️',
      prompt:
        'Electronic and dance music. House, techno, ambient, and synth-driven tracks.'
    },
    {
      id: 'acoustic',
      label: 'Acoustic',
      emoji: '🪕',
      prompt:
        'Acoustic and unplugged music. Singer-songwriter, folk, country, and acoustic covers.'
    },
    {
      id: 'vpop',
      label: 'V-Pop',
      emoji: '🇻🇳',
      prompt:
        'Popular Vietnamese music (V-Pop). Trending Vietnamese hits, ballads, and modern Vietnamese pop songs.'
    },
    {
      id: 'vrock',
      label: 'Viet Rock & Hip Hop',
      emoji: '🎸🇻🇳',
      prompt:
        'Vietnamese rock and hip hop. Vietnamese rap, Viet rock bands, and Vietnamese hip hop artists.'
    },
    {
      id: 'punk-metal',
      label: 'Punk & Metal',
      emoji: '🤘',
      prompt:
        'Punk and metal music. Hardcore punk, pop punk, thrash metal, metalcore, and heavy metal anthems.'
    }
  ]

  const originalPresetIdArb = fc.constantFrom(
    ...originalPresets.map((p) => p.id)
  )

  it('each original preset exists in PRESET_PROMPTS with unchanged id, label, emoji, and prompt', () => {
    fc.assert(
      fc.property(originalPresetIdArb, (presetId) => {
        const expected = originalPresets.find((p) => p.id === presetId)!
        const actual = PRESET_PROMPTS.find((p) => p.id === presetId)
        assert.ok(actual, `preset "${presetId}" should exist in PRESET_PROMPTS`)
        assert.equal(actual.id, expected.id)
        assert.equal(actual.label, expected.label)
        assert.equal(actual.emoji, expected.emoji)
        assert.equal(actual.prompt, expected.prompt)
      }),
      PBT_CONFIG
    )
  })

  it('all 11 original presets are present in PRESET_PROMPTS', () => {
    fc.assert(
      fc.property(originalPresetIdArb, (presetId) => {
        const found = PRESET_PROMPTS.some((p) => p.id === presetId)
        assert.ok(
          found,
          `original preset "${presetId}" must be in PRESET_PROMPTS`
        )
      }),
      PBT_CONFIG
    )
  })
})

// Feature: drinking-anthems-preset, Property 2: Saved preset selection restored over default
describe('Property 2: Saved preset selection restored over default', () => {
  // **Validates: Requirements 3.1**

  const validPresetIdArb = fc.constantFrom(...PRESET_PROMPTS.map((p) => p.id))

  /**
   * Replicate getInitialState logic (not exported from hook) so we can
   * exercise it with a mocked localStorage in a non-React context.
   */
  function getInitialState(): AiSuggestionsState {
    const defaultState: AiSuggestionsState = {
      selectedPresetId: PRESET_PROMPTS[0]?.id ?? null,
      customPrompt: '',
      autoFillTargetSize: 10
    }

    if (
      typeof window === 'undefined' &&
      typeof globalThis.localStorage === 'undefined'
    ) {
      return defaultState
    }

    const savedState = globalThis.localStorage?.getItem('ai-suggestions-state')

    if (savedState) {
      try {
        const parsed = JSON.parse(savedState) as AiSuggestionsState
        return {
          ...defaultState,
          ...parsed
        }
      } catch {
        // Fall back to defaults on parse failure
      }
    }

    return defaultState
  }

  it('restores saved preset ID from localStorage rather than defaulting to PRESET_PROMPTS[0].id', () => {
    fc.assert(
      fc.property(validPresetIdArb, (savedPresetId) => {
        const savedState: AiSuggestionsState = {
          selectedPresetId: savedPresetId,
          customPrompt: '',
          autoFillTargetSize: 10
        }

        // Mock globalThis.localStorage
        const originalLocalStorage = globalThis.localStorage
        const mockStorage: Record<string, string> = {
          'ai-suggestions-state': JSON.stringify(savedState)
        }
        Object.defineProperty(globalThis, 'localStorage', {
          value: {
            getItem: (key: string) => mockStorage[key] ?? null,
            setItem: () => {},
            removeItem: () => {},
            clear: () => {},
            length: 0,
            key: () => null
          },
          writable: true,
          configurable: true
        })

        try {
          const result = getInitialState()
          assert.equal(
            result.selectedPresetId,
            savedPresetId,
            `expected selectedPresetId to be "${savedPresetId}" from localStorage, not the default "${PRESET_PROMPTS[0].id}"`
          )
        } finally {
          // Restore original localStorage
          Object.defineProperty(globalThis, 'localStorage', {
            value: originalLocalStorage,
            writable: true,
            configurable: true
          })
        }
      }),
      PBT_CONFIG
    )
  })
})
