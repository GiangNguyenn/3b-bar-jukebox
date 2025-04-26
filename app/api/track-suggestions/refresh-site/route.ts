import { NextResponse } from 'next/server'
import { z } from 'zod'
import { songsBetweenRepeatsSchema } from '@/app/admin/components/track-suggestions/validations/trackSuggestions'
import { findSuggestedTrack } from '@/services/trackSuggestion'
import { DEFAULT_MARKET } from '@/shared/constants/trackSuggestion'
import { sendApiRequest } from '@/shared/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Configure timeout
export const maxDuration = 60 // 60 seconds

interface SpotifyPlaylist {
  id: string
  name: string
}

interface SpotifyPlaylistResponse {
  items: SpotifyPlaylist[]
}

interface SpotifyTrack {
  id: string
  track: {
    id: string
  }
}

interface SpotifyPlaylistTracksResponse {
  items: SpotifyTrack[]
}

interface SpotifyPlaybackState {
  item: {
    id: string
  } | null
}

const refreshRequestSchema = z.object({
  genres: z.array(z.string()).min(1).max(10),
  yearRange: z.tuple([
    z.number().min(1900),
    z.number().max(new Date().getFullYear())
  ]),
  popularity: z.number().min(0).max(100),
  allowExplicit: z.boolean(),
  maxSongLength: z.number().min(3).max(20), // In minutes
  songsBetweenRepeats: songsBetweenRepeatsSchema
})

interface RefreshResponse {
  success: boolean
  message?: string
  searchDetails?: {
    attempts: number
    totalTracksFound: number
    excludedTrackIds: string[]
    minPopularity: number
    genresTried: string[]
    trackDetails: Array<{
      name: string
      popularity: number
      isExcluded: boolean
      isPlayable: boolean
      duration_ms: number
      explicit: boolean
    }>
  }
}

export function GET(): NextResponse<{ message: string }> {
  return NextResponse.json({ message: 'Refresh site endpoint is active' })
}

export async function POST(
  request: Request
): Promise<NextResponse<RefreshResponse>> {
  try {
    const body = (await request.json()) as unknown
    const validatedData = refreshRequestSchema.parse(body)

    // Get current playlist tracks to check for duplicates
    const playlistResponse = await sendApiRequest<SpotifyPlaylistResponse>({
      path: 'me/playlists',
      method: 'GET'
    })

    const fixedPlaylist = playlistResponse.items.find(
      (playlist) => playlist.name === '3B Saigon'
    )

    if (!fixedPlaylist) {
      return NextResponse.json(
        {
          success: false,
          message: 'Fixed playlist not found'
        },
        { status: 404 }
      )
    }

    const playlistTracks = await sendApiRequest<SpotifyPlaylistTracksResponse>({
      path: `playlists/${fixedPlaylist.id}/tracks`,
      method: 'GET'
    })

    const existingTrackIds = new Set(
      playlistTracks.items.map((item) => item.track.id)
    )

    // Get currently playing track to avoid immediate repeats
    const playbackState = await sendApiRequest<SpotifyPlaybackState>({
      path: 'me/player',
      method: 'GET'
    })
    const currentTrackId = playbackState?.item?.id ?? null

    // Find a suggested track
    const result = await findSuggestedTrack(
      Array.from(existingTrackIds),
      currentTrackId,
      DEFAULT_MARKET,
      validatedData
    )

    if (!result.track) {
      return NextResponse.json(
        {
          success: false,
          message: 'No suitable track found',
          searchDetails: result.searchDetails
        },
        { status: 404 }
      )
    }

    // Add the track to the playlist
    await sendApiRequest({
      path: `playlists/${fixedPlaylist.id}/tracks`,
      method: 'POST',
      body: {
        uris: [result.track.uri]
      }
    })

    return NextResponse.json({
      success: true,
      message: 'Track added successfully',
      searchDetails: result.searchDetails
    })
  } catch (error) {
    console.error('[Refresh Site] Error:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          errors: error.errors.map((err) => ({
            field: err.path.join('.'),
            message: err.message
          }))
        },
        { status: 400 }
      )
    }

    const errorMessage =
      error instanceof Error ? error.message : 'An error occurred'

    return NextResponse.json(
      {
        success: false,
        message: errorMessage
      },
      {
        status:
          error instanceof Error && error.message.includes('timeout')
            ? 504
            : 500,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    )
  }
}
