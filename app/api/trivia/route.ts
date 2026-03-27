import { NextRequest, NextResponse } from 'next/server'
import { triviaQuestionRequestSchema, triviaQuestionResponseSchema } from '@/shared/validations/trivia'
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
    return NextResponse.json({ error: 'Venice AI API key is not configured' }, { status: 500 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = triviaQuestionRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 400 })
  }

  const { profile_id, spotify_track_id, track_name, artist_name, album_name } = parsed.data

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
        logger('INFO', `Cache expired (stale) for track ${spotify_track_id}, generating new`)
      }
    }

    if (cacheError && cacheError.code !== 'PGRST116') {
      logger('ERROR', 'Error fetching cache:', cacheError.message, cacheError)
      // We can swallow this and try generating a new one anyway
    }

    // 2. Generate via Venice AI
    logger('INFO', `Generating new trivia for track ${spotify_track_id}`)
    
    const systemPrompt = `You are a music trivia master. Generate a multiple-choice trivia question about the song or artist provided.
The question MUST be accurate, interesting, and moderately difficult.
CRITICAL RULE: DO NOT EVER ask what album the song is from or what year it was released. Avoid basic chart position questions.
Instead, focus on:
- Interesting behind-the-scenes production facts
- Meaning or inspiration behind the lyrics
- The artist's history, influences, or personal life context
- Pop culture appearances (movies, TV shows, games)
- Guest performers, samples, or unique instruments used

You MUST respond with a valid JSON object matching this schema exactly:
{"question": "...", "options": ["A", "B", "C", "D"], "correctIndex": 0}
Do not include any other text or markdown formatting outside the JSON object.`

    const veniceResponse = await fetch('https://api.venice.ai/api/v1/chat/completions', {
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
          { role: 'user', content: `Generate a fascinating and unique trivia question focusing on the song "${track_name}" by ${artist_name} (from the album "${album_name}"). Remember, absolutely NO questions about the album name or release year! Provide 4 options and the correct index.` }
        ],
        max_tokens: 300
      })
    })

    if (!veniceResponse.ok) {
      const errorText = await veniceResponse.text()
      logger('ERROR', 'Venice AI error:', veniceResponse.status.toString() + ' ' + errorText)
      return NextResponse.json({ error: 'Venice AI request failed' }, { status: 500 })
    }

    const data = await veniceResponse.json() as { choices: Array<{ message: { content: string } }> }
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      logger('ERROR', 'Empty content returned from Venice')
      return NextResponse.json({ error: 'Empty response from AI' }, { status: 500 })
    }

    let parsedContent: unknown
    try {
      parsedContent = JSON.parse(content)
    } catch {
      logger('ERROR', 'Failed to parse Venice AI JSON:', content)
      return NextResponse.json({ error: 'Invalid JSON from AI' }, { status: 500 })
    }

    const validatedAI = triviaQuestionResponseSchema.safeParse(parsedContent)
    if (!validatedAI.success) {
      logger('ERROR', 'AI response failed schema validation', JSON.stringify(validatedAI.error.issues))
      return NextResponse.json({ error: 'Schema validation failed for AI output' }, { status: 500 })
    }

    const { question, options, correctIndex } = validatedAI.data

    // 3. Shuffle options and adjust correctIndex
    const indexedOptions = options.map((opt, i) => ({ opt, isCorrect: i === correctIndex }))
    for (let i = indexedOptions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indexedOptions[i], indexedOptions[j]] = [indexedOptions[j], indexedOptions[i]]
    }

    const finalOptions = indexedOptions.map((o) => o.opt)
    const finalCorrectIndex = indexedOptions.findIndex((o) => o.isCorrect)

    // 4. Cache it (Upsert allows overwriting expired ones based on UNIQUE constraint)
    const { error: insertError } = await supabaseAdmin.from('trivia_questions').upsert({
      profile_id,
      spotify_track_id,
      question,
      options: finalOptions,
      correct_index: finalCorrectIndex,
      created_at: new Date().toISOString()
    }, { onConflict: 'profile_id, spotify_track_id' })

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
    logger('ERROR', 'Caught exception in /api/trivia:', errorMessage, err instanceof Error ? err : undefined)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
