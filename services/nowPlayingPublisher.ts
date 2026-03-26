import { supabaseBrowser } from '@/lib/supabase-browser'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { createModuleLogger } from '@/shared/utils/logger'

const logger = createModuleLogger('NowPlayingPublisher')

let lastPublishedTrackId: string | null = null
let lastPublishedIsPlaying: boolean | null = null

/**
 * Publishes the current playback state to the now_playing table in Supabase.
 * Only publishes when the track or play/pause state actually changes
 * to avoid unnecessary writes.
 */
export async function publishNowPlaying(
  profileId: string,
  state: SpotifyPlaybackState | null
): Promise<void> {
  const trackId = state?.item?.id ?? null
  const isPlaying = state?.is_playing ?? false

  // Skip if nothing meaningful changed
  if (
    trackId === lastPublishedTrackId &&
    isPlaying === lastPublishedIsPlaying
  ) {
    return
  }

  lastPublishedTrackId = trackId
  lastPublishedIsPlaying = isPlaying

  const row = trackId
    ? {
        profile_id: profileId,
        spotify_track_id: state!.item.id,
        track_name: state!.item.name,
        artist_name: state!.item.artists?.[0]?.name ?? '',
        album_name: state!.item.album?.name ?? '',
        album_art_url: state!.item.album?.images?.[0]?.url ?? '',
        duration_ms: state!.item.duration_ms ?? 0,
        is_playing: isPlaying,
        progress_ms: state!.progress_ms ?? 0,
        updated_at: new Date().toISOString()
      }
    : {
        profile_id: profileId,
        spotify_track_id: null,
        track_name: null,
        artist_name: null,
        album_name: null,
        album_art_url: null,
        duration_ms: null,
        is_playing: false,
        progress_ms: 0,
        updated_at: new Date().toISOString()
      }

  const { error } = await supabaseBrowser
    .from('now_playing')
    .upsert(row, { onConflict: 'profile_id' })

  if (error) {
    logger('ERROR', `Failed to publish now_playing: ${error.message}`)
  }
}

/**
 * Resets the publisher's dedup state. Useful when the player is destroyed.
 */
export function resetNowPlayingPublisher(): void {
  lastPublishedTrackId = null
  lastPublishedIsPlaying = null
}
