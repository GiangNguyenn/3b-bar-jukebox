import { usePlaylistData } from './usePlaylistData'
import { useCurrentlyPlaying } from './useCurrentlyPlaying'
import { useUpcomingTracks } from './useUpcomingTracks'
import { usePlaylistRefresh } from './usePlaylistRefresh'
import { type TrackSuggestionsState } from '@/shared/types/trackSuggestions'

export const usePlaylist = (
  playlistId: string,
  trackSuggestionsState?: TrackSuggestionsState
) => {
  // Use focused hooks
  const {
    playlist,
    error: playlistError,
    refreshPlaylist,
    isLoading: playlistLoading
  } = usePlaylistData(playlistId)
  const {
    currentlyPlaying,
    error: currentlyPlayingError,
    isLoading: currentlyPlayingLoading
  } = useCurrentlyPlaying()
  const upcomingTracks = useUpcomingTracks(playlist, currentlyPlaying)
  const handleRefresh = usePlaylistRefresh(playlistId, refreshPlaylist)

  return {
    playlist,
    upcomingTracks,
    currentlyPlaying,
    error: playlistError || currentlyPlayingError,
    refreshPlaylist: handleRefresh,
    isLoading: playlistLoading || currentlyPlayingLoading
  }
}
