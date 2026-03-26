import { NextRequest, NextResponse } from 'next/server'
import {
  DJ_PERSONALITY_IDS,
  DEFAULT_DJ_PERSONALITY,
  DJ_PERSONALITIES
} from '@/shared/constants/djPersonalities'

// Vercel max function duration — set to 30s to accommodate slow LLM responses.
// Requires at least the Pro plan for values > 10s.
export const maxDuration = 30

const FETCH_TIMEOUT_MS = 25000 // 25s — leaves headroom before the 30s function limit

const ENGLISH_LLM_MODEL = 'llama-3.3-70b'
const VIETNAMESE_LLM_MODEL = 'qwen3-235b-a22b-instruct-2507'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const apiKey = process.env.VENICE_AI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Venice AI API key is not configured' },
      { status: 500 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { trackName, artistName, recentScripts, language, personality } =
    body as Record<string, unknown>
  const isVietnamese = language === 'vietnamese'

  if (!trackName || typeof trackName !== 'string') {
    return NextResponse.json(
      { error: 'Missing required field: trackName' },
      { status: 400 }
    )
  }
  if (!artistName || typeof artistName !== 'string') {
    return NextResponse.json(
      { error: 'Missing required field: artistName' },
      { status: 400 }
    )
  }

  const recentScriptsList = Array.isArray(recentScripts)
    ? (recentScripts as string[])
        .filter((s) => typeof s === 'string')
        .slice(0, 5)
    : []

  const recentScriptsNote =
    recentScriptsList.length > 0
      ? ` Avoid repeating phrases, sentence structures, or themes from these recent announcements you already made: ${recentScriptsList.map((s, i) => `[${i + 1}] "${s}"`).join(' ')}`
      : ''

  const resolvedPersonality =
    typeof personality === 'string' && DJ_PERSONALITY_IDS.includes(personality)
      ? personality
      : DEFAULT_DJ_PERSONALITY
  const personalityPrompt = DJ_PERSONALITIES.find(
    (p) => p.value === resolvedPersonality
  )!.prompt

  try {
    const model = isVietnamese ? VIETNAMESE_LLM_MODEL : ENGLISH_LLM_MODEL
    const systemPrompt = isVietnamese
      ? 'Không quá 2 câu có thể đọc trong 10 giây hoặc ít hơn. Bạn là một DJ radio tên "DJ 3B" đang chơi nhạc tại quán bia thủ công "3B Saigon". Hãy viết một đoạn giới thiệu ngắn bằng tiếng Việt tự nhiên cho bài hát tiếp theo. Ngắn gọn và tự nhiên. Chỉ thỉnh thoảng mới nhắc đến bia hoặc quán bar, không phải lần nào cũng nhắc.' +
        recentScriptsNote
      : `No more than 2 sentences that can be spoken in 10 seconds or less.  English language only.  You are a ${personalityPrompt} DJ playing music in a craft beer bar called 3B Saigon. Write a short announcement of no more than 2 sentences introducing the next track. Be informative but concise. Only occasionally mention beer or the bar — most of the time just focus on the music.` +
        'You are aware that you are an AI with a female voice though do not say that.  Never mention the date or time.' +
        recentScriptsNote

    const veniceResponse = await fetch(
      'https://api.venice.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: `Introduce the next track: "${trackName}" by ${artistName}.`
            }
          ],
          max_tokens: 150
        })
      }
    )

    if (!veniceResponse.ok) {
      const errorBody = await veniceResponse.text()
      console.error(
        '[dj-script] Venice AI error:',
        veniceResponse.status,
        errorBody
      )
      return NextResponse.json(
        { error: 'Venice AI request failed', detail: errorBody },
        { status: 500 }
      )
    }

    const data = (await veniceResponse.json()) as {
      choices: Array<{ message: { content: string } }>
    }
    const script = data.choices?.[0]?.message?.content

    if (!script) {
      return NextResponse.json(
        { error: 'Venice AI returned an empty script' },
        { status: 500 }
      )
    }

    // Reject garbled model output — repeated backslashes or excessive
    // non-ASCII characters indicate an inference glitch.
    const backslashRatio = (script.match(/\\/g) ?? []).length / script.length
    if (backslashRatio > 0.1 || /\\{3,}/.test(script)) {
      console.error(
        '[dj-script] Garbled script rejected:',
        script.slice(0, 200)
      )
      return NextResponse.json(
        { error: 'Venice AI returned an unusable script' },
        { status: 500 }
      )
    }

    return NextResponse.json({ script })
  } catch {
    return NextResponse.json(
      { error: 'Failed to contact Venice AI' },
      { status: 500 }
    )
  }
}
