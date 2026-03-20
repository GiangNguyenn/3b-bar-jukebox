import { NextRequest, NextResponse } from 'next/server'

const ENGLISH_LLM_MODEL = 'llama-3.3-70b'
const VIETNAMESE_LLM_MODEL = 'qwen3-235b-a22b-instruct-2507'

export async function POST(request: NextRequest) {
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

  const { trackName, artistName, recentScripts, language } = body as Record<
    string,
    unknown
  >
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

  try {
    const model = isVietnamese ? VIETNAMESE_LLM_MODEL : ENGLISH_LLM_MODEL
    const systemPrompt = isVietnamese
      ? 'Không quá 2 câu có thể đọc trong 10 giây hoặc ít hơn. Bạn là một DJ radio tên "DJ 3B" đang chơi nhạc tại quán bia thủ công "3B Saigon". Hãy viết một đoạn giới thiệu ngắn bằng tiếng Việt tự nhiên cho bài hát tiếp theo. Ngắn gọn và tự nhiên.' +
        recentScriptsNote
      : 'No more than 2 sentences that can be spoken in 10 seconds or less.  Do not generate non english characters.  You are an laid back, relaxed and chill radio DJ called DJ 3B playing music in a craft beer bar called 3B Saigon. Write a short announcement of no more than 2 sentences introducing the next track. Be informative but concise.' +
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
      return NextResponse.json(
        { error: 'Venice AI request failed' },
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

    return NextResponse.json({ script })
  } catch {
    return NextResponse.json(
      { error: 'Failed to contact Venice AI' },
      { status: 500 }
    )
  }
}
