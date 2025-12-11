import { NextRequest, NextResponse } from 'next/server'
import { sendApiRequest } from '@/shared/api'
import { supabase } from '@/lib/supabase'
import { createModuleLogger } from '@/shared/utils/logger'
import {
  safeBackfillTrackGenre,
  safeBackfillArtistGenres
} from '@/services/game/genreBackfill'
import { upsertArtistProfile } from '@/services/game/dgsCache'

const logger = createModuleLogger('TrackUpsert')

interface SpotifyTrack {
  id: string
  name: string
  artists: Array<{ name: string; id: string }>
  album: {
    name: string
    release_date: string
  }
  duration_ms: number
  popularity: number
  uri: string
}

interface SpotifyArtist {
  id: string
  name: string
  genres: string[]
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body = (await request.json()) as { spotifyTrackId?: string }
    const { spotifyTrackId } = body

    // Validate Spotify track ID format
    if (
      !spotifyTrackId ||
      spotifyTrackId.includes('-') || // UUIDs have hyphens
      spotifyTrackId.length !== 22 || // Spotify track IDs are always 22 chars
      !/^[0-9A-Za-z]+$/.test(spotifyTrackId) // Only alphanumeric
    ) {
      logger('WARN', `Invalid Spotify track ID format: ${spotifyTrackId}`)
      return NextResponse.json(
        { error: 'Invalid track ID format' },
        { status: 400 }
      )
    }

    // Fetch full track details from Spotify API (server-side, with app token)
    const trackData = await sendApiRequest<SpotifyTrack>({
      path: `tracks/${spotifyTrackId}`,
      method: 'GET',
      useAppToken: true,
      retryConfig: {
        maxRetries: 2,
        baseDelay: 500,
        maxDelay: 2000
      }
    })

    if (!trackData) {
      logger(
        'WARN',
        `No track data returned for Spotify track ID: ${spotifyTrackId}`
      )
      return NextResponse.json({ error: 'Track not found' }, { status: 404 })
    }

    // Fetch artist details to get genres
    let genre: string | null = null
    if (trackData.artists && trackData.artists.length > 0) {
      const primaryArtistId = trackData.artists[0].id
      if (primaryArtistId) {
        try {
          const artistData = await sendApiRequest<SpotifyArtist>({
            path: `artists/${primaryArtistId}`,
            method: 'GET',
            useAppToken: true,
            retryConfig: {
              maxRetries: 2,
              baseDelay: 500,
              maxDelay: 1000
            }
          })

          if (artistData?.genres && artistData.genres.length > 0) {
            genre = artistData.genres[0]
          }
        } catch (artistError) {
          // Genre is optional, log warning but continue
          logger(
            'WARN',
            `Failed to fetch artist genres for artist ID: ${primaryArtistId}`,
            undefined,
            artistError instanceof Error ? artistError : undefined
          )
        }
      }
    }

    // Extract release year from album release date (format: YYYY-MM-DD or YYYY)
    let releaseYear: number | null = null
    if (trackData.album?.release_date) {
      const yearMatch = trackData.album.release_date.match(/^(\d{4})/)
      if (yearMatch) {
        releaseYear = parseInt(yearMatch[1], 10)
      }
    }

    // Upsert track to Supabase tracks table
    const { error: upsertError } = await supabase.from('tracks').upsert(
      {
        spotify_track_id: trackData.id,
        name: trackData.name,
        artist: trackData.artists[0]?.name || 'Unknown Artist',
        album: trackData.album.name,
        duration_ms: trackData.duration_ms,
        popularity: trackData.popularity,
        spotify_url: trackData.uri,
        genre: genre,
        release_year: releaseYear
      },
      { onConflict: 'spotify_track_id' }
    )

    if (upsertError) {
      logger(
        'ERROR',
        `Failed to upsert track to database: ${trackData.name} (${spotifyTrackId})`,
        undefined,
        upsertError as Error
      )
      return NextResponse.json(
        { error: 'Failed to upsert track' },
        { status: 500 }
      )
    }

    // Ensure artist profile is cached/upserted if we fetched artist data
    if (trackData.artists && trackData.artists.length > 0) {
      const primaryArtist = trackData.artists[0]
      if (primaryArtist?.id) {
        void upsertArtistProfile({
          spotify_artist_id: primaryArtist.id,
          name: primaryArtist.name,
          genres: genre ? [genre] : [],
          popularity: undefined,
          follower_count: undefined
        })
        // If genre still null, queue full backfill to enrich artist
        if (!genre) {
          void safeBackfillArtistGenres(primaryArtist.id, primaryArtist.name)
        }
      }
    }

    // If genre still missing, queue async backfill for the track
    if (!genre) {
      const primaryArtistName = trackData.artists?.[0]?.name ?? 'Unknown Artist'
      void safeBackfillTrackGenre(
        trackData.id,
        primaryArtistName,
        releaseYear,
        trackData.popularity ?? null
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger(
      'ERROR',
      'Exception in track upsert API',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    )
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
