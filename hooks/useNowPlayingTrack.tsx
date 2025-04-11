import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'
import { handleOperationError, AppError } from '@/shared/utils/errorHandling'
import React from 'react'
import useSWR from 'swr'

const useNowPlayingTrack = () => {
  const fetcher = async () => {
    return handleOperationError(
      async () => {
        const response = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player/currently-playing'
        })
        return response
      },
      'useNowPlayingTrack',
      (error) => {
        console.error(
          '[useNowPlayingTrack] Error fetching current track:',
          error
        )
      }
    )
  }

  const { data, error, mutate, isLoading } = useSWR(
    'currently-playing-state',
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      refreshInterval: 10000 // Check every 10 seconds
    }
  )

  return {
    data,
    isLoading: isLoading || error,
    error: error
      ? error instanceof AppError
        ? error
        : new AppError(error.message, error, 'useNowPlayingTrack')
      : null,
    refetchPlaylists: mutate
  }
}

export default useNowPlayingTrack
