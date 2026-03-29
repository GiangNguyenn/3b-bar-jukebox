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

    // 2. Fetch recent questions for this profile to inform diversity
    const { data: recentQuestions } = await supabaseAdmin
      .from('trivia_questions')
      .select('question, question_type')
      .eq('profile_id', profile_id)
      .neq('spotify_track_id', spotify_track_id)
      .order('created_at', { ascending: false })
      .limit(15)

    // Build two lists: typed labels (preferred) and raw text (fallback for old rows)
    const recentTypesUsed: string[] = []
    const recentQuestionTexts: string[] = []
    for (const r of recentQuestions ?? []) {
      if (r.question_type) recentTypesUsed.push(r.question_type as string)
      recentQuestionTexts.push(r.question as string)
    }

    // 3. Deterministically pick the target question type
    // All available types — ordered so that universally-safe ones come first
    // (they work regardless of how obscure or niche the artist is)
    const ALL_QUESTION_TYPES = [
      'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8',
      'Q9', 'Q10', 'Q11', 'Q12', 'Q13', 'Q14', 'Q15', 'Q16'
    ]
    const usedSet = new Set(recentTypesUsed)
    // Pick the first type not used recently; if all used, start over from Q1
    const targetType =
      ALL_QUESTION_TYPES.find((t) => !usedSet.has(t)) ?? ALL_QUESTION_TYPES[0]

    logger('INFO', `Targeting question type ${targetType} for track ${spotify_track_id} (recent: ${Array.from(usedSet).join(', ') || 'none'})`)

    // 4. Generate via Venice AI
    logger('INFO', `Generating new trivia for track ${spotify_track_id}`)

    // Q1-Q8: low-risk music questions about the current track/artist
    // Q9-Q16: universal general knowledge (no artist context — zero hallucination risk)
    const QUESTION_TYPE_DESCRIPTIONS: Record<string, string> = {
      Q1:  'Genre ancestry — which iconic musical movement, legendary scene, or classic artist this artist draws directly from',
      Q2:  'Country or city roots — the country or city the artist is from, framed in an interesting way',
      Q3:  'Instrument mastery — a surprising instrument this artist plays, or the primary instrument central to their signature sound',
      Q4:  'Collaboration story — a famous artist they worked with closely, a notable feature, or a supergroup they belong to',
      Q5:  'Record label journey — which influential label signed them, or how they got their deal',
      Q6:  'Career milestone — a surprising or impressive achievement: award, chart breakthrough, streaming record, or industry first',
      Q7:  'Cultural crossover — an appearance in film, TV, gaming, a commercial, or a viral cultural moment',
      Q8:  'Origin story — how or where the artist launched their career, or a surprising fact about their musical beginnings',
      // General knowledge — completely independent of the song/artist
      Q9:  'GENERAL: World geography or famous landmarks — e.g. capital cities, largest oceans, famous mountains or structures',
      Q10: 'GENERAL: Science or nature fact — e.g. planets, human body, animals, chemistry, or physics (well-established textbook facts only)',
      Q11: 'GENERAL: Famous inventors or inventions — e.g. who invented the telephone, the World Wide Web, or the light bulb',
      Q12: 'GENERAL: Iconic movies or global box office — e.g. highest-grossing films, famous franchises, iconic directors',
      Q13: 'GENERAL: Olympic sports or global sporting records — e.g. Olympic rings, FIFA World Cup records, world athletics records',
      Q14: 'GENERAL: Famous artworks or their creators — e.g. who painted the Mona Lisa, Sistine Chapel, Starry Night',
      Q15: 'GENERAL: Universally known world firsts — e.g. first Moon landing, first aeroplane flight, first Olympic Games host city',
      Q16: 'GENERAL: Mathematics or logic — e.g. number of sides on shapes, value of pi, basic number theory (universally agreed facts only)',
    }

    const isGeneralKnowledge = ['Q9','Q10','Q11','Q12','Q13','Q14','Q15','Q16'].includes(targetType)

    const targetDescription = QUESTION_TYPE_DESCRIPTIONS[targetType] ?? 'general music knowledge about the artist'

    const systemPrompt = isGeneralKnowledge
      ? `You are a bar trivia host writing fun general knowledge questions for an international audience. Your highest priority is FACTUAL ACCURACY — only use universally agreed, well-established facts that any educated adult would accept as indisputably correct. The question must be accessible to someone from any country.

QUESTION TYPE: ${targetType} — ${targetDescription}

RULES:
- Only use facts you are 100% certain about — facts that appear in every textbook and encyclopedia.
- All four answer options must be plausible, but only ONE must be correct.
- Do not invent or approximate facts.
- Questions should be fun and interesting, not obscure.

RESPOND with ONLY a valid JSON object — no markdown, no explanation:
{"question": "...", "options": ["A", "B", "C", "D"], "correctIndex": 0, "questionType": "${targetType}"}`
      : `You are a music trivia expert writing questions for a fun bar trivia game. Your two core priorities are:
1. FACTUAL ACCURACY — never state anything you are not 100% certain is true.
2. ENTERTAINMENT — the question should be genuinely interesting and fun. A great trivia question surprises people or makes them say "I didn't know that!"

Generate one multiple-choice trivia question about the song or artist provided.

QUESTION TYPE (mandatory): ${targetType} — ${targetDescription}
Do not switch to a different type.

FACTUAL ACCURACY RULES:
- Only assert facts you are highly confident about.
- All four answer options must be plausible, but only ONE must be correct.
- Do not invent fake details that could be confused with real facts.
- If you cannot form a confident question of type ${targetType} for this artist, generate the most interesting factual question you can about this artist — but still label it ${targetType}.

AVOID: specific release years, exact chart positions, lyrics interpretation.

RESPOND with ONLY a valid JSON object — no markdown, no explanation:
{"question": "...", "options": ["A", "B", "C", "D"], "correctIndex": 0, "questionType": "${targetType}"}`

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
          temperature: 0.9,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: isGeneralKnowledge
                ? `Generate a fun and interesting ${targetType} general knowledge question suitable for an international bar trivia audience. Category: ${targetDescription}. Provide 4 answer options and the correctIndex.`
                : `Generate a ${targetType} trivia question about the song "${track_name}" by ${artist_name} (album: "${album_name}"). Question type must be ${targetType}. Provide 4 answer options and the correctIndex.`
            }
          ],
          max_tokens: 400
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
    // Extract questionType if the AI returned it (it may not for first rollout)
    const questionType =
      typeof (parsedContent as Record<string, unknown>).questionType ===
      'string'
        ? ((parsedContent as Record<string, unknown>).questionType as string)
        : null

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

    // 5. Cache it (Upsert allows overwriting expired ones based on UNIQUE constraint)
    const { error: insertError } = await supabaseAdmin
      .from('trivia_questions')
      .upsert(
        {
          profile_id,
          spotify_track_id,
          question,
          options: finalOptions,
          correct_index: finalCorrectIndex,
          ...(questionType ? { question_type: questionType } : {}),
          created_at: new Date().toISOString()
        },
        { onConflict: 'profile_id, spotify_track_id' }
      )

    if (insertError) {
      logger('ERROR', 'Failed to cache generated question', insertError.message)
      // still return success to the user!
    }

    if (questionType) {
      logger('INFO', `Question type selected by AI: ${questionType}`)
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
