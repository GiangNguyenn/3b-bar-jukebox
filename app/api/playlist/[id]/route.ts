import { NextResponse } from 'next/server'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaylistItem } from '@/shared/types/spotify'
import { cache } from '@/shared/utils/cache'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { fetchPublicToken } from '@/shared/token/publicToken'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('API Playlist')

interface SpotifyTrack {
  id: string
  name: string
  artists: { id: string; name: string }[]
  album: {
    name: string
    release_date: string
  }
  duration_ms: number
  popularity: number
  external_urls: {
    spotify: string
  }
}

interface SpotifyArtist {
  id: string
  name: string
  genres: string[]
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse<SpotifyPlaylistItem | { error: string }>> {
  try {
    const cacheKey = `api-playlist-${params.id}`
    const cachedData = cache.get<SpotifyPlaylistItem>(cacheKey)
    if (cachedData) {
      return NextResponse.json(cachedData)
    }

    const playlist = await sendApiRequest<SpotifyPlaylistItem>({
      path: `playlists/${params.id}`
    })

    cache.set(cacheKey, playlist)

    return NextResponse.json(playlist)
  } catch (error) {
    logger('ERROR', 'Failed to fetch playlist', undefined, error as Error)
    return NextResponse.json(
      { error: 'Failed to fetch playlist' },
      { status: 500 }
    )
  }
}

const addTrackSchema = z.object({
  trackUri: z.string(),
  profileId: z.string().uuid().optional(),
  username: z.string()
})

type AddTrackResponseBody =
  | { message: string }
  | { error: string; details?: string }
  | { error: z.ZodIssue[] }

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse<AddTrackResponseBody>> {
  try {
    const body = (await request.json()) as {
      trackUri: string
      profileId?: string
      username: string
    }
    const {
      trackUri,
      profileId: initialProfileId,
      username
    } = addTrackSchema.parse(body)
    let profileId = initialProfileId
    logger(
      'INFO',
      'Parsed body',
      JSON.stringify({ trackUri, profileId: initialProfileId })
    )

    if (!profileId) {
      logger(
        'INFO',
        `No profileId provided. Fetching from DB with username: ${username}`
      )
      const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .ilike('display_name', username)
        .single()

      if (error || !data) {
        logger(
          'ERROR',
          `Failed to fetch profile for username: ${username}`,
          undefined,
          error || new Error('No data returned')
        )
        throw new Error(`Failed to fetch profile for username: ${username}`)
      }

      if (data && 'id' in data) {
        profileId = data.id as string
      } else {
        throw new Error('Invalid data structure from Supabase')
      }
      logger('INFO', `Found profileId: ${profileId} for username: ${username}`)
    }

    const token = await fetchPublicToken(username)

    await sendApiRequest({
      path: `playlists/${params.id}/tracks`,
      method: 'POST',
      body: {
        uris: [trackUri]
      },
      public: true,
      token: token.access_token
    })
    logger('INFO', 'Track added to Spotify playlist')

    if (profileId) {
      logger('INFO', 'Profile ID found, proceeding to log suggestion.')
      const trackId = trackUri.split(':').pop()
      if (!trackId) {
        throw new Error('Invalid track URI')
      }
      logger('INFO', 'Track ID', JSON.stringify({ trackId }))

      const trackDetails = await sendApiRequest<SpotifyTrack>({
        path: `tracks/${trackId}`,
        token: token.access_token
      })
      logger('INFO', 'Fetched track details', JSON.stringify(trackDetails))

      const artistDetails = await sendApiRequest<SpotifyArtist>({
        path: `artists/${trackDetails.artists[0].id}`,
        token: token.access_token
      })
      logger('INFO', 'Fetched artist details', JSON.stringify(artistDetails))

      const rpcParams = {
        p_profile_id: profileId,
        p_spotify_track_id: trackDetails.id,
        p_track_name: trackDetails.name,
        p_artist_name: trackDetails.artists[0]?.name ?? 'Unknown Artist',
        p_album_name: trackDetails.album.name,
        p_duration_ms: trackDetails.duration_ms,
        p_popularity: trackDetails.popularity,
        p_spotify_url: trackDetails.external_urls.spotify,
        p_genre: artistDetails.genres?.[0] ?? null,
        p_release_year: new Date(trackDetails.album.release_date).getFullYear()
      }
      logger('INFO', 'RPC Params', JSON.stringify(rpcParams))

      const { error: rpcError } = await supabase.rpc(
        'log_track_suggestion',
        rpcParams
      )

      if (rpcError) {
        logger(
          'ERROR',
          'Error logging track suggestion',
          JSON.stringify(rpcError)
        )
      } else {
        logger('INFO', 'Track suggestion logged successfully')
      }
    } else {
      logger('INFO', 'No profile ID found, skipping suggestion logging.')
    }

    return NextResponse.json({ message: 'Track added successfully' })
  } catch (error) {
    logger('ERROR', 'Detailed Error in POST request', undefined, error as Error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 })
    }
    const errorMessage =
      error instanceof Error ? error.message : 'An unknown error occurred'
    return NextResponse.json(
      { error: 'Failed to add track to playlist', details: errorMessage },
      { status: 500 }
    )
  }
}
