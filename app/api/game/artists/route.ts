import { NextResponse } from 'next/server'
import { musicService } from '@/services/musicService'
import { getAdminToken } from '@/services/game/adminAuth'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('ApiPopularArtists')

export interface PopularArtistResponse {
  id?: string
  name: string
  spotify_artist_id: string
  genre?: string
}

export const dynamic = 'force-dynamic' // Ensure we don't cache static empty response

export async function GET(): Promise<NextResponse> {
  try {
    // 1. Try fetching from DB first via Service (Efficient)
    const { data: artists, source } = await musicService.getPopularArtists(200)

    // 2. If we have enough artists, return them
    // Threshold: 20 artists is enough to start a game, but we prefer 50+
    if (artists.length >= 20) {
      logger('INFO', `Returning ${artists.length} artists from ${source}`)

      const response: PopularArtistResponse[] = artists
        .filter(
          (a) => a.spotify_artist_id && !a.spotify_artist_id.includes('-')
        )
        .map((artist) => ({
          id: artist.id,
          name: artist.name,
          spotify_artist_id: artist.spotify_artist_id!, // Guaranteed by filter
          genre:
            artist.genres && artist.genres.length > 0
              ? artist.genres[0]
              : undefined
        }))

      return NextResponse.json({ artists: response })
    }

    // 3. Fallback: DB is empty or too small. Fetch from Spotify using admin token.
    logger(
      'INFO',
      `Insufficient artists in DB (${artists.length}). Attempting Spotify fallback.`
    )

    const token = await getAdminToken()
    if (!token) {
      logger('ERROR', 'Failed to get admin token for fallback fetch')
      // Return whatever we have from DB
      return NextResponse.json({ artists: artists })
    }

    // Fetch with fallback (this seeds the DB)
    const { data: fallbackArtists, source: fallbackSource } =
      await musicService.getPopularArtistsWithFallback(token, 200)

    logger(
      'INFO',
      `Fallback fetch complete. Returning ${fallbackArtists.length} artists from ${fallbackSource}`
    )

    const response: PopularArtistResponse[] = fallbackArtists
      .filter((a) => a.spotify_artist_id && !a.spotify_artist_id.includes('-'))
      .map((artist) => ({
        id: artist.id,
        name: artist.name,
        spotify_artist_id: artist.spotify_artist_id!,
        genre:
          artist.genres && artist.genres.length > 0
            ? artist.genres[0]
            : undefined
      }))

    return NextResponse.json({ artists: response })
  } catch (err) {
    logger(
      'ERROR',
      'Internal server error',
      'GET',
      err instanceof Error ? err : undefined
    )
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
