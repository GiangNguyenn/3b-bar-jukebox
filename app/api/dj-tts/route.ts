import { NextRequest, NextResponse } from 'next/server'

const ENGLISH_TTS_MODEL = 'tts-kokoro'
const ENGLISH_TTS_VOICE = 'af_nova'
const VIETNAMESE_TTS_MODEL = 'tts-qwen3-1-7b'

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

  const { text, language } = body as Record<string, unknown>
  const isVietnamese = language === 'vietnamese'

  if (!text || typeof text !== 'string') {
    return NextResponse.json(
      { error: 'Missing required field: text' },
      { status: 400 }
    )
  }

  try {
    const veniceResponse = await fetch(
      'https://api.venice.ai/api/v1/audio/speech',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(
          isVietnamese
            ? { model: VIETNAMESE_TTS_MODEL, input: text, response_format: 'mp3' }
            : { model: ENGLISH_TTS_MODEL, voice: ENGLISH_TTS_VOICE, input: text, response_format: 'mp3' }
        )
      }
    )

    if (!veniceResponse.ok) {
      const errorBody = await veniceResponse.text()
      console.error(
        '[dj-tts] Venice TTS error:',
        veniceResponse.status,
        errorBody
      )
      return NextResponse.json(
        { error: 'Venice AI TTS request failed', detail: errorBody },
        { status: 500 }
      )
    }

    const audioBuffer = await veniceResponse.arrayBuffer()

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store'
      }
    })
  } catch {
    return NextResponse.json(
      { error: 'Failed to contact Venice AI TTS' },
      { status: 500 }
    )
  }
}
