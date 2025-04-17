export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { PlaylistRefreshServiceImpl } from '@/services/playlistRefresh'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'
import { FALLBACK_GENRES } from '@/shared/constants/trackSuggestion'

interface RefreshResponse {
  success: boolean
  message?: string
  playerStateRefresh?: boolean
}

interface TrackSuggestionsState {
  genres: string[]
  yearRange: [number, number]
  popularity: number
  allowExplicit: boolean
  maxSongLength: number
  songsBetweenRepeats: number
}

export async function GET(
  request: Request
): Promise<NextResponse<RefreshResponse>> {
  try {
    const url = new URL(request.url)
    const forceParam = url.searchParams.get('force')
    const shouldForce = forceParam === 'true'

    // Get track suggestions state from query parameters
    const trackSuggestionsState: TrackSuggestionsState = {
      genres:
        (url.searchParams
          .get('genres')
          ?.split(',') as (typeof FALLBACK_GENRES)[number][]) ??
        Array.from(FALLBACK_GENRES),
      yearRange: [
        Number(url.searchParams.get('yearRangeStart')) ?? 1950,
        Number(url.searchParams.get('yearRangeEnd')) ?? new Date().getFullYear()
      ],
      popularity: Number(url.searchParams.get('popularity')) ?? 50,
      allowExplicit: url.searchParams.get('allowExplicit') === 'true',
      maxSongLength: Number(url.searchParams.get('maxSongLength')) ?? 300,
      songsBetweenRepeats:
        Number(url.searchParams.get('songsBetweenRepeats')) ?? 5
    }

    // Check if genres match fallback genres
    const genres = trackSuggestionsState.genres
    const isUsingFallbackGenres =
      genres.length === FALLBACK_GENRES.length &&
      genres.every((genre) =>
        FALLBACK_GENRES.includes(genre as (typeof FALLBACK_GENRES)[number])
      )

    if (isUsingFallbackGenres) {
      console.warn(
        '[PARAM CHAIN] Warning: Using fallback genres instead of user-selected genres'
      )
    }

    console.log(
      '[PARAM CHAIN] Using genres from query params in refresh-site/route.ts:',
      trackSuggestionsState.genres
    )

    const result =
      await PlaylistRefreshServiceImpl.getInstance().refreshPlaylist(
        shouldForce,
        trackSuggestionsState
      )

    // Only refresh player state if the playlist was actually updated
    if (result.success) {
      console.log('Playlist was updated, refreshing player state')

      try {
        // Get the current playback state
        const playbackState = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET'
        })

        // If there's an active device
        if (playbackState?.device?.id) {
          console.log('Found active device, reinitializing playback')

          // Store current state before pausing
          const currentTrackUri = playbackState.item?.uri
          const currentPosition = playbackState.progress_ms
          const contextUri = playbackState.context?.uri

          // First pause playback
          await sendApiRequest({
            path: 'me/player/pause',
            method: 'PUT'
          })

          // Then resume with the exact same context and position
          await sendApiRequest({
            path: 'me/player/play',
            method: 'PUT',
            body: {
              context_uri: contextUri,
              position_ms: currentPosition,
              offset: currentTrackUri ? { uri: currentTrackUri } : undefined
            }
          })

          result.playerStateRefresh = true
        }
      } catch (error) {
        console.error('Error refreshing player state:', error)
        // Don't fail the request if player refresh fails
      }
    }

    return NextResponse.json(result, {
      status: result.success ? 200 : 500
    })
  } catch (error) {
    console.error('Error in refresh route:', error)
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      {
        status: 500
      }
    )
  }
}
