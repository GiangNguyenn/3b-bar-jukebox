import { sendApiRequest } from '@/shared/api'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('TrackUpsert')

/**
 * Upserts track metadata to Supabase tracks table whenever a song is played.
 * Calls the server-side API route which fetches full track details from Spotify API
 * including popularity, genre, and release year.
 * This is a fire-and-forget operation that won't interrupt playback if it fails.
 *
 * @param spotifyTrackId - The Spotify track ID to upsert
 */
export async function upsertPlayedTrack(spotifyTrackId: string): Promise<void> {
  try {
    // Validate Spotify track ID format
    if (
      !spotifyTrackId ||
      spotifyTrackId.includes('-') || // UUIDs have hyphens
      spotifyTrackId.length !== 22 || // Spotify track IDs are always 22 chars
      !/^[0-9A-Za-z]+$/.test(spotifyTrackId) // Only alphanumeric
    ) {
      logger('WARN', `Invalid Spotify track ID format: ${spotifyTrackId}`)
      return
    }

    // Call server-side API route to upsert track
    await sendApiRequest<{ success: boolean }>({
      path: '/tracks/upsert',
      method: 'POST',
      body: { spotifyTrackId },
      isLocalApi: true,
      retryConfig: {
        maxRetries: 2,
        baseDelay: 500,
        maxDelay: 2000
      }
    })
  } catch (error) {
    // Log warning but don't throw - this should never interrupt playback
    logger(
      'WARN',
      `Exception in upsertPlayedTrack for track ID: ${spotifyTrackId}`,
      undefined,
      error instanceof Error ? error : new Error(String(error))
    )
  }
}
