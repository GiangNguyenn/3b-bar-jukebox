import {
  getRelatedArtistsServer,
  getArtistTopTracksServer
} from './spotifyApiServer'
import type {
  SpotifyArtist,
  TrackDetails,
  SpotifyPlaybackState
} from '@/shared/types/spotify'

export interface TargetArtist {
  id?: string // Optional - not used for matching, only for display if needed
  name: string
  spotify_artist_id?: string
  genre?: string // Primary genre for display
  genres?: string[] // All genres
  popularity?: number
  followers?: number
  image_url?: string
}

export interface GameOptionTrack {
  track: TrackDetails
  artist: SpotifyArtist
}

const MAX_GAME_OPTIONS = 12

/**
 * Derives the primary artist ID from the current playback state.
 * Falls back to the first artist in the item if available.
 */
export function getCurrentArtistId(
  playbackState: SpotifyPlaybackState | null
): string | null {
  const itemArtist = playbackState?.item?.artists?.[0]
  return (itemArtist && itemArtist.id) || null
}

/**
 * Fetches up to MAX_GAME_OPTIONS artists related to the given artist.
 * Results are lightly shuffled to introduce variety between turns.
 * Server-side only - uses server-side Spotify API utilities.
 * @param artistId - The Spotify artist ID
 * @param token - Optional user token for authentication
 */
export async function getRelatedArtistsForGame(
  artistId: string,
  token?: string
): Promise<SpotifyArtist[]> {
  const related = await getRelatedArtistsServer(artistId, token)

  if (!related.length) return []

  // Keep the original relevance ordering from getRelatedArtistsServer
  // but request a larger buffer so we have enough candidates even if
  // some artists don't yield usable tracks.
  const desiredArtistCount = Math.max(MAX_GAME_OPTIONS * 3, 36)
  return related.slice(0, desiredArtistCount)
}

/**
 * Builds up to MAX_GAME_OPTIONS candidate tracks for the game.
 * Each option comes from a different related artist's top tracks.
 * Server-side only - uses server-side Spotify API utilities.
 * @param relatedArtists - Array of related artists
 * @param token - Optional user token for authentication
 */
export async function getGameOptionTracks(
  relatedArtists: SpotifyArtist[],
  token?: string
): Promise<GameOptionTrack[]> {
  if (!relatedArtists.length) return []

  const options: GameOptionTrack[] = []
  const seenTrackIds = new Set<string>() // Track duplicate track IDs
  const seenArtistIds = new Set<string>() // Ensure one option per artist

  // Single pass: at most one unique track per artist, in order of relevance.
  // This guarantees that options come from distinct artists.
  for (const artist of relatedArtists) {
    if (options.length >= MAX_GAME_OPTIONS) {
      break
    }

    if (!artist.id || seenArtistIds.has(artist.id)) {
      continue
    }

    const topTracks = await getArtistTopTracksServer(artist.id, token)

    // Pick the first top track that isn't a duplicate
    const uniqueTrack = topTracks.find(
      (track) => track && !seenTrackIds.has(track.id)
    )

    if (!uniqueTrack) {
      continue
    }

    seenTrackIds.add(uniqueTrack.id)
    seenArtistIds.add(artist.id)
    options.push({
      track: uniqueTrack,
      artist
    })

    if (options.length >= MAX_GAME_OPTIONS) {
      break
    }
  }

  return options
}
