import { useMemo } from 'react'
import { TrackItem, SpotifyPlaybackState } from '@/shared/types/spotify'
import { filterUpcomingTracks } from '@/lib/utils'

interface PlaylistData {
  tracks: {
    items: TrackItem[]
  }
}

export function useUpcomingTracks(
  playlist: PlaylistData | undefined,
  currentlyPlaying: SpotifyPlaybackState | undefined
) {
  const upcomingTracks = useMemo(() => {
    if (!playlist || !currentlyPlaying?.item?.id) return []
    return filterUpcomingTracks(playlist.tracks.items, currentlyPlaying.item.id)
  }, [playlist, currentlyPlaying?.item?.id])

  return upcomingTracks
}
