import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'
import { handleOperationError, AppError } from '@/shared/utils/errorHandling'
import React from 'react'
import useSWR from 'swr'

const useNowPlayingTrack = () => {
  const fetcher = async () => {
    console.log('[useNowPlayingTrack] Fetching current track')
    return handleOperationError(
      async () => {
        // Construct the URL with query parameters
        const queryParams = new URLSearchParams({
          market: 'from_token',
          additional_types: 'track,episode'
        })
        const path = `me/player/currently-playing?${queryParams.toString()}`

        console.log('[useNowPlayingTrack] Making API request to:', path)
        const response = await sendApiRequest<SpotifyPlaybackState>({
          path,
          extraHeaders: {
            'Content-Type': 'application/json'
          }
        })

        console.log('[useNowPlayingTrack] Received response:', {
          isPlaying: response?.is_playing,
          trackName: response?.item?.name,
          trackId: response?.item?.id
        })

        return response
      },
      'useNowPlayingTrack',
      (error) => {
        console.error(
          '[useNowPlayingTrack] Error fetching current track:',
          error,
          {
            timestamp: new Date().toISOString(),
            errorMessage:
              error instanceof Error ? error.message : 'Unknown error',
            errorStack: error instanceof Error ? error.stack : undefined
          }
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
      refreshInterval: 10000, // Check every 10 seconds
      onError: (err) => {
        console.error('[useNowPlayingTrack] SWR Error:', err, {
          timestamp: new Date().toISOString()
        })
      },
      onSuccess: (data) => {
        console.log('[useNowPlayingTrack] Successfully fetched track:', {
          isPlaying: data?.is_playing,
          trackName: data?.item?.name,
          trackId: data?.item?.id
        })
      }
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
