/**
 * Server-side only Spotify API utilities
 * These methods can be safely used in API routes without importing client-side code
 */
import { sendApiRequest } from '@/shared/api'
import type { SpotifyArtist, TrackDetails } from '@/shared/types/spotify'
import { POPULAR_TARGET_ARTISTS } from './gameService'

/**
 * Fetches artists related to the given artist (server-side only)
 * Uses the recommendations endpoint since the related-artists endpoint was deprecated on Nov 27, 2024
 * @param artistId - The Spotify artist ID
 * @param token - Optional user token. If provided, uses this token instead of app token.
 */
export async function getRelatedArtistsServer(
  artistId: string,
  token?: string
): Promise<SpotifyArtist[]> {
  // Validate artist ID
  if (!artistId || artistId.trim() === '') {
    throw new Error('Artist ID is required')
  }

  // Verify artist exists first (this helps debug 404 errors)
  try {
    const artistPath = `artists/${artistId}`
    console.log('[spotifyApiServer] Verifying artist exists:', {
      artistId,
      usingToken: token ? 'user' : 'app'
    })
    await sendApiRequest<{ id: string; name: string }>({
      path: artistPath,
      method: 'GET',
      token,
      useAppToken: !token,
      retryConfig: {
        maxRetries: 1,
        baseDelay: 500,
        maxDelay: 1000
      }
    })
    console.log(
      '[spotifyApiServer] Artist verified, fetching related artists via recommendations'
    )
  } catch (verifyError) {
    console.error('[spotifyApiServer] Artist verification failed:', {
      artistId,
      error:
        verifyError instanceof Error ? verifyError.message : String(verifyError)
    })
    throw new Error(`Artist not found: ${artistId}`)
  }

  // Since both related-artists and recommendations endpoints were deprecated on Nov 27, 2024,
  // we use a multi-level approach with top tracks to find related artists:
  // 1. Get the current artist's top tracks and extract collaborating artists
  // 2. If we need more, get top tracks from those artists and extract more artists
  let relatedArtists: SpotifyArtist[] = []
  const artistMap = new Map<string, SpotifyArtist>()
  const processedArtistIds = new Set<string>([artistId]) // Track which artists we've already processed

  try {
    console.log(
      '[spotifyApiServer] Extracting related artists from top tracks (multi-level approach)'
    )

    // Level 1: Get top tracks from the seed artist
    const seedTopTracks = await getArtistTopTracksServer(artistId, token)
    const level1Artists: SpotifyArtist[] = []

    // Extract unique artists from seed artist's top tracks
    for (const track of seedTopTracks) {
      if (track.artists) {
        for (const artist of track.artists) {
          if (
            artist.id !== artistId &&
            artist.id &&
            artist.name &&
            !artistMap.has(artist.id)
          ) {
            const artistObj = {
              id: artist.id,
              name: artist.name
            }
            artistMap.set(artist.id, artistObj)
            level1Artists.push(artistObj)
            processedArtistIds.add(artist.id)
          }
        }
      }
    }

    relatedArtists = [...level1Artists]
    console.log(
      '[spotifyApiServer] Level 1: Found',
      level1Artists.length,
      'related artists from seed artist top tracks'
    )

    // Level 2: If we need more artists, get top tracks from level 1 artists
    // Limit to first 5 level 1 artists to avoid too many API calls
    if (relatedArtists.length < 10 && level1Artists.length > 0) {
      const artistsToProcess = level1Artists.slice(0, 5)
      const level2Artists: SpotifyArtist[] = []

      for (const level1Artist of artistsToProcess) {
        try {
          const level1TopTracks = await getArtistTopTracksServer(
            level1Artist.id,
            token
          )

          for (const track of level1TopTracks) {
            if (track.artists) {
              for (const artist of track.artists) {
                // Skip artists we've already seen
                if (
                  !processedArtistIds.has(artist.id) &&
                  artist.id !== artistId &&
                  artist.id &&
                  artist.name &&
                  !artistMap.has(artist.id)
                ) {
                  const artistObj = {
                    id: artist.id,
                    name: artist.name
                  }
                  artistMap.set(artist.id, artistObj)
                  level2Artists.push(artistObj)
                  processedArtistIds.add(artist.id)

                  // Stop if we have enough artists
                  if (relatedArtists.length + level2Artists.length >= 20) {
                    break
                  }
                }
              }
            }
          }

          // Stop processing more level 1 artists if we have enough
          if (relatedArtists.length + level2Artists.length >= 20) {
            break
          }
        } catch (error) {
          // If fetching top tracks for a level 1 artist fails, continue with next one
          console.warn(
            '[spotifyApiServer] Failed to get top tracks for level 1 artist:',
            {
              artistId: level1Artist.id,
              error: error instanceof Error ? error.message : String(error)
            }
          )
        }
      }

      relatedArtists = [...level1Artists, ...level2Artists]
      console.log(
        '[spotifyApiServer] Level 2: Found',
        level2Artists.length,
        'additional artists. Total:',
        relatedArtists.length
      )
    }

    // Prioritize primary artists (first artist in each track) over featured artists
    // This gives us more variety of main artists rather than just collaborations
    const primaryArtists: SpotifyArtist[] = []
    const featuredArtists: SpotifyArtist[] = []

    // Re-process to separate primary vs featured
    for (const track of seedTopTracks) {
      if (track.artists && track.artists.length > 0) {
        const primaryArtist = track.artists[0]
        if (
          primaryArtist.id !== artistId &&
          relatedArtists.some((a) => a.id === primaryArtist.id)
        ) {
          if (!primaryArtists.some((a) => a.id === primaryArtist.id)) {
            primaryArtists.push(
              relatedArtists.find((a) => a.id === primaryArtist.id)!
            )
          }
        }
      }
    }

    // Add remaining artists as featured
    for (const artist of relatedArtists) {
      if (!primaryArtists.some((a) => a.id === artist.id)) {
        featuredArtists.push(artist)
      }
    }

    // Return primary artists first, then featured
    relatedArtists = [...primaryArtists, ...featuredArtists]

    console.log(
      '[spotifyApiServer] Found',
      relatedArtists.length,
      'related artists via top tracks (multi-level)',
      {
        primaryArtists: primaryArtists.length,
        featuredArtists: featuredArtists.length,
        artistIds: relatedArtists.map((a) => a.id).slice(0, 10)
      }
    )

    if (relatedArtists.length > 0) {
      return relatedArtists
    }
  } catch (error) {
    console.error(
      '[spotifyApiServer] Error extracting related artists from top tracks:',
      {
        artistId,
        error: error instanceof Error ? error.message : String(error)
      }
    )
  }

  // Fallback: If top tracks method returned no results, use genre-based search
  if (relatedArtists.length === 0) {
    try {
      console.log(
        '[spotifyApiServer] Top tracks returned no collaborators, trying genre-based search'
      )

      // Get the artist's full profile to access genres
      const artistProfile = await sendApiRequest<{ genres: string[] }>({
        path: `artists/${artistId}`,
        method: 'GET',
        token,
        useAppToken: !token,
        retryConfig: {
          maxRetries: 2,
          baseDelay: 500,
          maxDelay: 2000
        }
      })

      const genres = artistProfile.genres || []
      console.log('[spotifyApiServer] Artist genres:', genres)

      if (genres.length > 0) {
        // Use the first genre (usually the most relevant)
        const primaryGenre = genres[0]

        // Search for artists in this genre
        // Use search endpoint to find artists by genre
        const searchQuery = `genre:"${primaryGenre}"`
        const searchResponse = await sendApiRequest<{
          artists: {
            items: Array<{ id: string; name: string }>
          }
        }>({
          path: `search?q=${encodeURIComponent(searchQuery)}&type=artist&limit=50&market=US`,
          method: 'GET',
          token,
          useAppToken: !token,
          retryConfig: {
            maxRetries: 2,
            baseDelay: 500,
            maxDelay: 2000
          }
        })

        // Extract unique artists, excluding the seed artist
        const genreArtists: SpotifyArtist[] = []
        if (searchResponse.artists?.items) {
          for (const artist of searchResponse.artists.items) {
            if (artist.id !== artistId && artist.id && artist.name) {
              if (!artistMap.has(artist.id)) {
                const artistObj = {
                  id: artist.id,
                  name: artist.name
                }
                artistMap.set(artist.id, artistObj)
                genreArtists.push(artistObj)

                // Stop when we have enough
                if (genreArtists.length >= 20) {
                  break
                }
              }
            }
          }
        }

        relatedArtists = genreArtists
        console.log(
          '[spotifyApiServer] Found',
          genreArtists.length,
          'related artists via genre search',
          {
            genre: primaryGenre,
            artistIds: genreArtists.map((a) => a.id).slice(0, 10)
          }
        )

        if (relatedArtists.length > 0) {
          return relatedArtists
        }
      }
    } catch (genreError) {
      console.warn('[spotifyApiServer] Genre search failed:', {
        artistId,
        error:
          genreError instanceof Error ? genreError.message : String(genreError)
      })
      console.error('[spotifyApiServer] Genre-based search also failed:', {
        artistId,
        error:
          genreError instanceof Error ? genreError.message : String(genreError)
      })
    }
  }

  // Final fallback: If all methods failed, use popular artists from curated list
  if (relatedArtists.length === 0) {
    console.warn(
      '[spotifyApiServer] All methods failed to find related artists, using popular artists fallback',
      {
        artistId
      }
    )

    // Use a subset of popular artists, excluding the current artist
    const fallbackArtists = POPULAR_TARGET_ARTISTS.filter(
      (artist) => artist.id !== artistId
    )
      .slice(0, 20)
      .map((artist) => ({
        id: artist.id,
        name: artist.name
      }))

    console.log(
      '[spotifyApiServer] Using',
      fallbackArtists.length,
      'popular artists as fallback'
    )
    return fallbackArtists
  }

  return relatedArtists
}

/**
 * Fetches the top tracks for a given artist (server-side only)
 * @param artistId - The Spotify artist ID
 * @param token - Optional user token. If provided, uses this token instead of app token.
 */
export async function getArtistTopTracksServer(
  artistId: string,
  token?: string
): Promise<TrackDetails[]> {
  try {
    const response = await sendApiRequest<{ tracks: TrackDetails[] }>({
      path: `artists/${artistId}/top-tracks?market=US`, // Market is required for top tracks
      method: 'GET',
      token, // Use provided token if available, otherwise useAppToken will be used
      useAppToken: !token, // Only use app token if no user token provided
      retryConfig: {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 10000
      }
    })
    return response.tracks || []
  } catch (error) {
    console.error('[spotifyApiServer] getArtistTopTracksServer error:', error)
    throw new Error(
      `Failed to fetch artist top tracks: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    )
  }
}
