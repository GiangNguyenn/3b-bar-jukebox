import useSWR from 'swr'
import { SpotifyPlayerQueue, TrackItem } from '@/shared/types/spotify'
import { sendApiRequest } from '@/shared/api'
import { handleOperationError } from '@/shared/utils/errorHandling'

const queueFetcher = () =>
  handleOperationError(
    () =>
      sendApiRequest<SpotifyPlayerQueue>({
        path: 'me/player/queue',
        method: 'GET'
      }),
    'QueueFetcher'
  )

export function useNowPlayingTrackWithPosition(
  playlist: TrackItem[]
): { position: number; track: TrackItem['track'] } | null {
  const { data: queue } = useSWR('user-queue', queueFetcher, {
    refreshInterval: 5000
  })

  if (!queue?.currently_playing || !playlist || playlist.length === 0) {
    return null
  }

  const currentlyPlayingUri = queue.currently_playing.uri
  const upcomingTrackUri = queue.queue[0]?.uri

  // Primary Strategy: High-Confidence Match
  if (upcomingTrackUri) {
    for (let i = 0; i < playlist.length - 1; i++) {
      if (
        playlist[i].track.uri === currentlyPlayingUri &&
        playlist[i + 1].track.uri === upcomingTrackUri
      ) {
        return { position: i, track: playlist[i].track }
      }
    }
  }

  // Fallback Strategy: End-of-Playlist Check
  const lastTrackInPlaylist = playlist[playlist.length - 1]
  if (
    lastTrackInPlaylist.track.uri === currentlyPlayingUri &&
    queue.queue.length === 0
  ) {
    return { position: playlist.length - 1, track: lastTrackInPlaylist.track }
  }

  // Failure Case: No match found
  return null
}
