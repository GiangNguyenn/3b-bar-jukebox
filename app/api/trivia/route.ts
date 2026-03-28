import { NextRequest, NextResponse } from 'next/server'
import {
  triviaQuestionRequestSchema,
  triviaQuestionResponseSchema
} from '@/shared/validations/trivia'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('ApiTrivia')
export const maxDuration = 30
const FETCH_TIMEOUT_MS = 25000
const ENGLISH_LLM_MODEL = 'llama-3.3-70b'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const apiKey = process.env.VENICE_AI_API_KEY
  if (!apiKey) {
    logger('ERROR', 'Venice AI API key is not configured')
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

  const parsed = triviaQuestionRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const { profile_id, spotify_track_id, track_name, artist_name, album_name } =
    parsed.data

  try {
    // 1. Check cache
    const { data: cachedQuestion, error: cacheError } = await supabaseAdmin
      .from('trivia_questions')
      .select('question, options, correct_index, created_at')
      .eq('profile_id', profile_id)
      .eq('spotify_track_id', spotify_track_id)
      .single()

    if (cachedQuestion) {
      const createdAt = new Date(cachedQuestion.created_at).getTime()
      const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
      const isExpired = Date.now() - createdAt > SEVEN_DAYS_MS

      if (!isExpired) {
        logger('INFO', `Cache hit for track ${spotify_track_id}`)
        return NextResponse.json({
          question: cachedQuestion.question,
          options: cachedQuestion.options as string[],
          correctIndex: cachedQuestion.correct_index,
          spotify_track_id
        })
      } else {
        logger(
          'INFO',
          `Cache expired (stale) for track ${spotify_track_id}, generating new`
        )
      }
    }

    if (cacheError && cacheError.code !== 'PGRST116') {
      logger('ERROR', 'Error fetching cache:', cacheError.message, cacheError)
      // We can swallow this and try generating a new one anyway
    }

    // 2. Generate via Venice AI
    logger('INFO', `Generating new trivia for track ${spotify_track_id}`)

    const systemPrompt = `You are a music trivia expert. Your single most important rule is FACTUAL ACCURACY — never state or imply anything you are not 100% certain is true.

Generate one multiple-choice trivia question about the song or artist provided. Follow these rules strictly:

FACTUAL ACCURACY (highest priority):
- Only assert facts you are highly confident about. If you are unsure of a detail, do NOT use it.
- It is far better to ask a simple, verifiable question than an interesting but potentially wrong one.
- All four answer options must be plausible, but only ONE must be correct. Do not invent fake options that could be confused with real facts.

PREFERRED QUESTION TYPES (use in order of confidence):
1. Songwriting or production credits (e.g., who co-wrote or produced the track)
2. Confirmed samples or interpolations used in the song
3. Well-known featured artists or guest performers
4. Genre, musical movement, or style the artist is primarily associated with
5. Country or city the artist is originally from
6. Widely reported awards the song or artist won (e.g., Grammy wins)
7. Confirmed appearances in major films, TV shows, or commercials
8. Instrument or vocal technique that is a defining characteristic of the artist

AVOID:
- Specific release years or album names
- Chart positions
- Obscure biographical details or anecdotes you are not certain about
- Lyrics interpretation (too subjective and unverifiable)
- Any claim that requires precise recall of an exact date, quote, or statistic

RESPONSE FORMAT:
You MUST respond with ONLY a valid JSON object — no markdown, no explanation, no extra text:
{"question": "...", "options": ["A", "B", "C", "D"], "correctIndex": 0}
The correctIndex is the zero-based index of the correct answer in the options array.`

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
          model: ENGLISH_LLM_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: `Generate a trivia question about the song "${track_name}" by ${artist_name} (album: "${album_name}"). Prioritise facts you are certain about. If you cannot think of a confidently known fact, fall back to a safe question about the artist's genre, home country, or a well-known collaborator. Provide 4 answer options and the correctIndex.`
            }
          ],
          max_tokens: 350
        })
      }
    )

    if (!veniceResponse.ok) {
      const errorText = await veniceResponse.text()
      logger(
        'ERROR',
        'Venice AI error:',
        veniceResponse.status.toString() + ' ' + errorText
      )
      return NextResponse.json(
        { error: 'Venice AI request failed' },
        { status: 500 }
      )
    }

    const data = (await veniceResponse.json()) as {
      choices: Array<{ message: { content: string } }>
    }
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      logger('ERROR', 'Empty content returned from Venice')
      return NextResponse.json(
        { error: 'Empty response from AI' },
        { status: 500 }
      )
    }

    let parsedContent: unknown
    try {
      parsedContent = JSON.parse(content)
    } catch {
      logger('ERROR', 'Failed to parse Venice AI JSON:', content)
      return NextResponse.json(
        { error: 'Invalid JSON from AI' },
        { status: 500 }
      )
    }

    const validatedAI = triviaQuestionResponseSchema.safeParse(parsedContent)
    if (!validatedAI.success) {
      logger(
        'ERROR',
        'AI response failed schema validation',
        JSON.stringify(validatedAI.error.issues)
      )
      return NextResponse.json(
        { error: 'Schema validation failed for AI output' },
        { status: 500 }
      )
    }

    const { question, options, correctIndex } = validatedAI.data

    // 3. Shuffle options and adjust correctIndex
    const indexedOptions = options.map((opt, i) => ({
      opt,
      isCorrect: i === correctIndex
    }))
    for (let i = indexedOptions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[indexedOptions[i], indexedOptions[j]] = [
        indexedOptions[j],
        indexedOptions[i]
      ]
    }

    const finalOptions = indexedOptions.map((o) => o.opt)
    const finalCorrectIndex = indexedOptions.findIndex((o) => o.isCorrect)

    // 4. Cache it (Upsert allows overwriting expired ones based on UNIQUE constraint)
    const { error: insertError } = await supabaseAdmin
      .from('trivia_questions')
      .upsert(
        {
          profile_id,
          spotify_track_id,
          question,
          options: finalOptions,
          correct_index: finalCorrectIndex,
          created_at: new Date().toISOString()
        },
        { onConflict: 'profile_id, spotify_track_id' }
      )

    if (insertError) {
      logger('ERROR', 'Failed to cache generated question', insertError.message)
      // still return success to the user!
    }

    return NextResponse.json({
      question,
      options: finalOptions,
      correctIndex: finalCorrectIndex,
      spotify_track_id
    })
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    logger(
      'ERROR',
      'Caught exception in /api/trivia:',
      errorMessage,
      err instanceof Error ? err : undefined
    )
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
