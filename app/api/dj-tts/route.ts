import { NextRequest, NextResponse } from 'next/server'
import { DJ_VOICE_IDS, DEFAULT_DJ_VOICE } from '@/shared/constants/djVoices'

// Vercel max function duration — set to 30s to accommodate slow TTS responses.
// Requires at least the Pro plan for values > 10s.
export const maxDuration = 60

const FETCH_TIMEOUT_MS = 55000 // 55s — leaves headroom before the 60s function limit

const ENGLISH_TTS_MODEL = 'tts-kokoro'
const VIETNAMESE_TTS_MODEL = 'tts-qwen3-0-6b'

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

  const { text, language, voice } = body as Record<string, unknown>
  const isVietnamese = language === 'vietnamese'

  if (!text || typeof text !== 'string') {
    return NextResponse.json(
      { error: 'Missing required field: text' },
      { status: 400 }
    )
  }

  const resolvedVoice =
    typeof voice === 'string' && DJ_VOICE_IDS.includes(voice)
      ? voice
      : DEFAULT_DJ_VOICE

  try {
    const veniceResponse = await fetch(
      'https://api.venice.ai/api/v1/audio/speech',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        body: JSON.stringify(
          isVietnamese
            ? {
                model: VIETNAMESE_TTS_MODEL,
                voice: 'Vivian',
                input: text,
                response_format: 'mp3'
              }
            : {
                model: ENGLISH_TTS_MODEL,
                voice: resolvedVoice,
                input: text,
                response_format: 'mp3'
              }
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
