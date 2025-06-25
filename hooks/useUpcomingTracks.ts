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
    if (!playlist) return []
    
    // Get the current track ID, or null if no track is playing
    const currentTrackId = currentlyPlaying?.item?.id || null
    
    return filterUpcomingTracks(playlist.tracks.items, currentTrackId)
  }, [playlist, currentlyPlaying?.item?.id])

  return upcomingTracks
}
