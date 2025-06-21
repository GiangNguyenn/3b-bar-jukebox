import { TrackItem, SpotifyPlaylistItem } from '@/shared/types/spotify'
import { sendApiRequest } from '@/shared/api'
import { useGetPlaylist } from './useGetPlaylist'
import { useTrackOperation } from './useTrackOperation'
import { ERROR_MESSAGES } from '@/shared/constants/errors'
import { useState } from 'react'

interface UseAddTrackToPlaylistProps {
  playlistId: string
}

export const useAddTrackToPlaylist = ({
  playlistId
}: UseAddTrackToPlaylistProps) => {
  const {
    isError: playlistError,
    refetchPlaylist,
    data: playlist
  } = useGetPlaylist(playlistId)
  const [pendingTracks, setPendingTracks] = useState<Set<string>>(new Set())
  const [optimisticTrack, setOptimisticTrack] = useState<TrackItem | null>(null)

  const { isLoading, error, isSuccess, executeOperation } = useTrackOperation({
    playlistId,
    playlistError,
    refetchPlaylist: async (optimisticData?: SpotifyPlaylistItem) => {
      return refetchPlaylist(optimisticData)
    }
  })

  const addTrack = async (track: TrackItem): Promise<void> => {
    const operation = async (track: TrackItem): Promise<void> => {
      // Optimistically update UI
      setPendingTracks((prev) => new Set(prev).add(track.track.uri))
      setOptimisticTrack(track)

      // Optimistically update playlist data
      if (playlist) {
        const optimisticPlaylist: SpotifyPlaylistItem = {
          ...playlist,
          tracks: {
            ...playlist.tracks,
            items: [
              ...playlist.tracks.items,
              {
                ...track,
                added_at: new Date().toISOString(),
                added_by: {
                  id: 'optimistic',
                  uri: 'spotify:user:optimistic',
                  href: 'https://api.spotify.com/v1/users/optimistic',
                  external_urls: {
                    spotify: 'https://open.spotify.com/user/optimistic'
                  },
                  type: 'user'
                }
              }
            ]
          }
        }
        // Update the cache with optimistic data
        await refetchPlaylist(optimisticPlaylist)
      }

      try {
        await sendApiRequest({
          path: `playlists/${playlistId}/tracks`,
          method: 'POST',
          body: {
            uris: [track.track.uri]
          }
        })
        // Refresh playlist with actual data
        await refetchPlaylist()
      } catch (error) {
        console.error('[Add Track] Error adding track:', error)
        // Revert optimistic update on error
        setPendingTracks((prev) => {
          const newSet = new Set(prev)
          newSet.delete(track.track.uri)
          return newSet
        })
        setOptimisticTrack(null)
        // Revert playlist data on error
        await refetchPlaylist()
        throw new Error(ERROR_MESSAGES.FAILED_TO_ADD)
      }
    }

    try {
      await executeOperation(operation, track)
    } catch (error) {
      console.error('[Add Track] Error adding track:', error)
      throw error // Re-throw the error to be caught by the caller
    } finally {
      // Clear pending state after operation completes
      setPendingTracks((prev) => {
        const newSet = new Set(prev)
        newSet.delete(track.track.uri)
        return newSet
      })
      setOptimisticTrack(null)
    }
  }

  return {
    addTrack,
    isLoading,
    error,
    isSuccess,
    pendingTracks: Array.from(pendingTracks),
    optimisticTrack
  }
}
