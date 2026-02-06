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

import { type NextRequest } from 'next/server'
import type { TargetArtist } from '@/services/gameService'

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL(request.url)
    const query = url.searchParams.get('q')

    let resultArtists: TargetArtist[] = []
    let source = 'UNKNOWN'

    if (query) {
      // Search mode
      const { data, source: searchSource } = await musicService.searchArtists(
        query,
        50
      )
      resultArtists = data
      source = searchSource
    } else {
      // Default: Popular artists
      // 1. Try fetching from DB first via Service (Efficient)
      const { data, source: popSource } =
        await musicService.getPopularArtists(200)
      resultArtists = data
      source = popSource

      // 3. Fallback: DB is empty or too small. Fetch from Spotify using admin token.
      if (resultArtists.length < 20) {
        logger(
          'INFO',
          `Insufficient artists in DB (${resultArtists.length}). Attempting Spotify fallback.`
        )

        const token = await getAdminToken()
        if (token) {
          const { data: fallbackArtists, source: fallbackSource } =
            await musicService.getPopularArtistsWithFallback(token, 200)

          resultArtists = fallbackArtists
          source = fallbackSource
          logger(
            'INFO',
            `Fallback fetch complete. Returning ${resultArtists.length} artists from ${source}`
          )
        } else {
          logger('ERROR', 'Failed to get admin token for fallback fetch')
        }
      }
    }

    // 2. Return results (Unified response)
    if (resultArtists.length > 0 || query) {
      if (!query) {
        logger(
          'INFO',
          `Returning ${resultArtists.length} artists from ${source}`
        )
      }

      const response: PopularArtistResponse[] = resultArtists
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

    // 3. Last resort fallback (should be covered above, but safe return)
    return NextResponse.json({ artists: [] })
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
