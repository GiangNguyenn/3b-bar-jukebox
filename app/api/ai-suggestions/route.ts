import { NextRequest, NextResponse } from 'next/server'
import {
  getAiSuggestions,
  getRecentlyPlayed,
  addToRecentlyPlayed
} from '@/services/aiSuggestion'
import { createModuleLogger } from '@/shared/utils/logger'
import { supabase } from '@/lib/supabase'
import { aiSuggestionsRequestSchema } from '@/shared/validations/aiSuggestionSchemas'

const logger = createModuleLogger('AISuggestionsAPI')

export const maxDuration = 30

export async function POST(request: NextRequest): Promise<NextResponse> {
  const apiKey = process.env.VENICE_AI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        tracks: [],
        error: 'Venice AI API key is not configured'
      },
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

  const { prompt, excludedTrackIds, queuedTracks, profileId } = parsed.data

  try {
    // Resolve username to profile UUID for recently played lookups
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .ilike('display_name', profileId)
      .single<{ id: string }>()

    const resolvedProfileId = profile?.id ?? profileId
    const recentlyPlayed = await getRecentlyPlayed(resolvedProfileId)

    const result = await getAiSuggestions(
      prompt,
      excludedTrackIds,
      recentlyPlayed,
      queuedTracks
    )

    // Record returned tracks as recently played (non-blocking, fire-and-forget)
    void Promise.all(
      result.tracks.map((track) =>
        addToRecentlyPlayed(resolvedProfileId, {
          spotifyTrackId: track.spotifyTrackId,
          title: track.title,
          artist: track.artist
        }).catch(() => {
          // Non-critical: silently ignore failures
        })
      )
    )

    return NextResponse.json({
      success: true,
      tracks: result.tracks.map((t) => ({
        id: t.spotifyTrackId,
        title: t.title,
        artist: t.artist
      })),
      failedResolutions: result.failedResolutions,
      recentlyPlayedCount: recentlyPlayed.length,
      recentlyPlayed: recentlyPlayed.map((t) => `${t.title} by ${t.artist}`)
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
