// Feature: dj-personality-options, Property 5: English prompt contains resolved personality fragment
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import {
  DJ_PERSONALITIES,
  DJ_PERSONALITY_IDS,
  DEFAULT_DJ_PERSONALITY
} from '@/shared/constants/djPersonalities'

const PBT_CONFIG = { numRuns: 100 }

/**
 * Mirrors the personality resolution + English prompt construction from route.ts.
 */
function buildEnglishSystemPrompt(
  personality: unknown,
  recentScriptsNote: string
): string {
  const resolvedPersonality =
    typeof personality === 'string' && DJ_PERSONALITY_IDS.includes(personality)
      ? personality
      : DEFAULT_DJ_PERSONALITY
  const personalityPrompt = DJ_PERSONALITIES.find(
    (p) => p.value === resolvedPersonality
  )!.prompt
  return (
    `No more than 2 sentences that can be spoken in 10 seconds or less.  English language only.  You are a ${personalityPrompt} DJ playing music in a craft beer bar called 3B Saigon. Write a short announcement of no more than 2 sentences introducing the next track. Be informative but concise. Only occasionally mention beer or the bar — most of the time just focus on the music.` +
    'You are aware that you are an AI with a female voice though do not say that.  Never mention the date or time.' +
    recentScriptsNote
  )
}

describe('Property 5: English prompt contains resolved personality fragment', () => {
  // **Validates: Requirements 4.1, 4.2, 4.4**

  it('for any valid personality ID, the English prompt contains that personality prompt fragment', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...DJ_PERSONALITY_IDS),
        fc.string(),
        (validId, recentNote) => {
          const prompt = buildEnglishSystemPrompt(validId, recentNote)
          const expected = DJ_PERSONALITIES.find(
            (p) => p.value === validId
          )!.prompt
          assert.ok(
            prompt.includes(expected),
            `Prompt for personality "${validId}" should contain "${expected}"`
          )
        }
      ),
      PBT_CONFIG
    )
  })

  it('for any invalid or missing personality, the prompt contains the default chill fragment', () => {
    const defaultFragment = DJ_PERSONALITIES.find(
      (p) => p.value === DEFAULT_DJ_PERSONALITY
    )!.prompt

    fc.assert(
      fc.property(
        fc.oneof(
          fc.string().filter((s) => !DJ_PERSONALITY_IDS.includes(s)),
          fc.constant(undefined),
          fc.constant(null)
        ),
        fc.string(),
        (invalidPersonality, recentNote) => {
          const prompt = buildEnglishSystemPrompt(
            invalidPersonality,
            recentNote
          )
          assert.ok(
            prompt.includes(defaultFragment),
            `Prompt for invalid personality should contain default fragment "${defaultFragment}"`
          )
        }
      ),
      PBT_CONFIG
    )
  })

  it('when a non-chill personality is selected, "laid back, relaxed and chill" must not appear', () => {
    const nonChillIds = DJ_PERSONALITY_IDS.filter((id) => id !== 'chill')

    fc.assert(
      fc.property(
        fc.constantFrom(...nonChillIds),
        fc.string(),
        (nonChillId, recentNote) => {
          const prompt = buildEnglishSystemPrompt(nonChillId, recentNote)
          assert.ok(
            !prompt.includes('laid back, relaxed and chill'),
            `Prompt for non-chill personality "${nonChillId}" must not contain "laid back, relaxed and chill"`
          )
        }
      ),
      PBT_CONFIG
    )
  })
})

// Feature: dj-personality-options, Property 6: Vietnamese prompt isolation

const VIETNAMESE_PROMPT =
  'Không quá 2 câu có thể đọc trong 10 giây hoặc ít hơn. Bạn là một DJ radio tên "DJ 3B" đang chơi nhạc tại quán bia thủ công "3B Saigon". Hãy viết một đoạn giới thiệu ngắn bằng tiếng Việt tự nhiên cho bài hát tiếp theo. Ngắn gọn và tự nhiên. Chỉ thỉnh thoảng mới nhắc đến bia hoặc quán bar, không phải lần nào cũng nhắc.'

function buildSystemPrompt(
  language: string,
  personality: unknown,
  recentScriptsNote: string
): string {
  const isVietnamese = language === 'vietnamese'
  if (isVietnamese) {
    return VIETNAMESE_PROMPT + recentScriptsNote
  }
  return buildEnglishSystemPrompt(personality, recentScriptsNote)
}

const ENGLISH_PERSONALITY_FRAGMENTS = DJ_PERSONALITIES.map((p) => p.prompt)

describe('Property 6: Vietnamese prompt isolation', () => {
  // **Validates: Requirements 4.3**

  it('for any personality value, when language is vietnamese, the system prompt starts with the fixed Vietnamese prompt', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom(...DJ_PERSONALITY_IDS),
          fc.string(),
          fc.constant(null),
          fc.constant(undefined)
        ),
        fc.string(),
        (anyPersonality, recentNote) => {
          const prompt = buildSystemPrompt(
            'vietnamese',
            anyPersonality,
            recentNote
          )
          assert.ok(
            prompt.startsWith(VIETNAMESE_PROMPT),
            `Vietnamese prompt must start with the fixed Vietnamese prompt, got: "${prompt.slice(0, 80)}..."`
          )
        }
      ),
      PBT_CONFIG
    )
  })

  it('for any personality value, when language is vietnamese, the system prompt must not contain any English personality prompt fragment', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom(...DJ_PERSONALITY_IDS),
          fc.string(),
          fc.constant(null),
          fc.constant(undefined)
        ),
        fc.string(),
        (anyPersonality, recentNote) => {
          const prompt = buildSystemPrompt(
            'vietnamese',
            anyPersonality,
            recentNote
          )
          for (const fragment of ENGLISH_PERSONALITY_FRAGMENTS) {
            assert.ok(
              !prompt.includes(fragment),
              `Vietnamese prompt must not contain English fragment "${fragment}"`
            )
          }
        }
      ),
      PBT_CONFIG
    )
  })
})
