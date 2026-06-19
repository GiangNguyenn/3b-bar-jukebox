import { NextRequest, NextResponse, after } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import {
  getAiSuggestions,
  getRecentlyPlayed,
  addToRecentlyPlayed
} from '@/services/aiSuggestion'
import { createModuleLogger } from '@/shared/utils/logger'
import { supabase } from '@/lib/supabase'
import { aiSuggestionsRequestSchema } from '@/shared/validations/aiSuggestionSchemas'
import { TokenService } from '@/services/tokenService'

const logger = createModuleLogger('AISuggestionsAPI')

const ADMIN_USERNAME = process.env.NEXT_PUBLIC_ADMIN_USERNAME ?? '3b'

export const maxDuration = 30

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Require a valid Supabase session — prevents unauthenticated access and
  // cross-user history lookups via caller-supplied profileId
  const cookieStore = await cookies()
  const supabaseSSR = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        }
      }
    }
  )
  const {
    data: { session }
  } = await supabaseSSR.auth.getSession()
  if (!session) {
    return NextResponse.json(
      { success: false, tracks: [], error: 'Unauthorized' },
      { status: 401 }
    )
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        success: false,
        tracks: [],
        error: 'Anthropic API key is not configured'
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

  // Get the admin user's Spotify token — required since Spotify restricted search
  // to user-authorized tokens (client credentials no longer work for /search or /tracks)
  const tokenService = new TokenService(supabase)
  let spotifyToken: string
  try {
    const tokenResult =
      await tokenService.getValidTokenByUsername(ADMIN_USERNAME)
    spotifyToken = tokenResult.accessToken
  } catch (error) {
    logger(
      'ERROR',
      'Failed to get Spotify user token for AI suggestion resolution',
      undefined,
      error instanceof Error ? error : undefined
    )
    return NextResponse.json(
      {
        success: false,
        tracks: [],
        error:
          'Spotify authentication unavailable — ensure the admin account is logged in'
      },
      { status: 503 }
    )
  }

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
      queuedTracks,
      spotifyToken
    )

    // Record returned tracks as recently played after the response is sent,
    // using after() so the serverless runtime keeps the function alive for these writes
    after(async () => {
      await Promise.all(
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
    })

    return NextResponse.json({
      success: true,
      tracks: result.tracks.map((t) => ({
        id: t.spotifyTrackId,
        title: t.title,
        artist: t.artist
      })),
      failedResolutions: result.failedResolutions,
      recentlyPlayedCount: recentlyPlayed.length
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
