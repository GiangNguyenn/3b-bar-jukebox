import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { PLAYER_LIFECYCLE_CONFIG } from '@/services/playerLifecycleConfig'

const { TRACK_END_THRESHOLD_MS } = PLAYER_LIFECYCLE_CONFIG

/**
 * Pure function that determines whether a track has finished playing by comparing
 * the current Spotify playback state against the last known state.
 *
 * Detects five finish conditions:
 *   1. Was playing → now paused/stopped at the end of the same track
 *   2. Track stopped and reset to position 0 (natural end)
 *   3. Track is at the end and not progressing
 *   4. Track is very near the end and has stalled
 *   5. Track is paused very near the end
 */
export function hasTrackFinished(
  currentState: SpotifyPlaybackState,
  lastState: SpotifyPlaybackState
): boolean {
  if (!currentState.item) return false

  const currentTrackId = currentState.item.id
  const lastTrackId = lastState.item?.id
  const isSameTrack = currentTrackId === lastTrackId

  const progress = currentState.progress_ms ?? 0
  const duration = currentState.item.duration_ms ?? 0

  const wasPlaying = lastState.is_playing
  const isPaused = !currentState.is_playing
  const isStopped = isPaused && progress === 0
  const hasProgressed = progress > (lastState.progress_ms ?? 0)

  const isAtEnd = duration > 0 && duration - progress < TRACK_END_THRESHOLD_MS
  const isNearEnd = duration > 0 && duration - progress < TRACK_END_THRESHOLD_MS / 2
  const hasStalled = !hasProgressed && wasPlaying && isSameTrack

  return (
    (wasPlaying && (isPaused || isStopped) && isSameTrack && isAtEnd) ||
    (isStopped && isSameTrack) ||
    (isAtEnd && isSameTrack && !hasProgressed && wasPlaying) ||
    (isNearEnd && hasStalled) ||
    (isPaused && isNearEnd && isSameTrack)
  )
}
