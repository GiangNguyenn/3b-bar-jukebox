import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'
import { handleOperationError, AppError } from '@/shared/utils/errorHandling'
import React from 'react'
import useSWR from 'swr'

const useNowPlayingTrack = () => {
  const fetcher = async () => {
    console.log('[useNowPlayingTrack] Starting fetch...')
    return handleOperationError(
      async () => {
        // Construct the URL with query parameters
        const queryParams = new URLSearchParams({
          market: 'from_token',
          additional_types: 'track,episode'
        })
        const path = `me/player/currently-playing?${queryParams.toString()}`
        console.log('[useNowPlayingTrack] Making request to:', path)

        const response = await sendApiRequest<SpotifyPlaybackState>({
          path,
          extraHeaders: {
            'Content-Type': 'application/json'
          }
        })

        // Log the response for debugging
        console.log('[useNowPlayingTrack] API Response:', {
          hasItem: !!response?.item,
          hasAlbum: !!response?.item?.album,
          hasImages: !!response?.item?.album?.images,
          images: response?.item?.album?.images,
          trackName: response?.item?.name,
          isPlaying: response?.is_playing,
          device: response?.device,
          timestamp: new Date().toISOString()
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
        console.log('[useNowPlayingTrack] SWR Success:', {
          hasData: !!data,
          timestamp: new Date().toISOString()
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
