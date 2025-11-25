/**
 * Utility functions for constructing Spotify URIs
 */

/**
 * Builds a Spotify track URI from a track ID
 * @param trackId - The Spotify track ID (with or without 'spotify:track:' prefix)
 * @returns A properly formatted Spotify track URI
 */
export function buildTrackUri(trackId: string): string {
  if (trackId.startsWith('spotify:track:')) {
    return trackId
  }
  return `spotify:track:${trackId}`
}
