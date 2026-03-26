import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAiSuggestions, getRecentlyPlayed } from '@/services/aiSuggestion'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('AISuggestionsAPI')

export const maxDuration = 30

export const aiSuggestionsRequestSchema = z.object({
  prompt: z
    .string()
    .min(1, 'Prompt must not be empty')
    .max(500, 'Prompt must be 500 characters or fewer'),
  excludedTrackIds: z.array(z.string()),
  profileId: z.string().min(1, 'Profile ID must not be empty')
})

export async function POST(request: NextRequest): Promise<NextResponse> {
  const apiKey = process.env.VENICE_AI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { success: false, tracks: [], error: 'Venice AI API key is not configured' },
      { status: 500 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, tracks: [], error: 'Invalid request body' },
      { status: 400 }
    )
  }

  const parsed = aiSuggestionsRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        tracks: [],
        error: 'Validation failed',
        details: parsed.error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message
        }))
      },
      { status: 400 }
    )
  }

  const { prompt, excludedTrackIds, profileId } = parsed.data

  try {
    const recentlyPlayed = await getRecentlyPlayed(profileId)
    const result = await getAiSuggestions(prompt, excludedTrackIds, recentlyPlayed)

    return NextResponse.json({
      success: true,
      tracks: result.tracks.map((t) => ({
        id: t.spotifyTrackId,
        title: t.title,
        artist: t.artist
      })),
      failedResolutions: result.failedResolutions
    })
  } catch (error) {
    logger(
      'ERROR',
      'AI suggestion request failed',
      undefined,
      error instanceof Error ? error : undefined
    )
    return NextResponse.json(
      { success: false, tracks: [], error: 'AI suggestion request failed' },
      { status: 500 }
    )
  }
}
