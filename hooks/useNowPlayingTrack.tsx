import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { handleOperationError, AppError } from '@/shared/utils/errorHandling'
import React, { useEffect, useRef } from 'react'
import useSWR from 'swr'

const useNowPlayingTrack = () => {
  const isMounted = useRef(true)
  const lastTrackId = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      isMounted.current = false
    }
  }, [])

  const fetcher = async () => {
    if (!isMounted.current) return undefined

    return handleOperationError(
      async () => {
        // Construct the URL with query parameters
        const queryParams = new URLSearchParams({
          market: 'from_token',
          additional_types: 'track,episode'
        })
        const path = `me/player/currently-playing?${queryParams.toString()}`

        const response = await sendApiRequest<SpotifyPlaybackState>({
          path,
          extraHeaders: {
            'Content-Type': 'application/json'
          }
        })

        if (!isMounted.current) return undefined

        // Only log if the track has changed
        const currentTrackId = response?.item?.id
        if (currentTrackId !== lastTrackId.current) {
          console.log('[useNowPlayingTrack] Track changed:', {
            isPlaying: response?.is_playing,
            trackName: response?.item?.name,
            trackId: currentTrackId
          })
          lastTrackId.current = currentTrackId ?? null
        }

        return response
      },
      'useNowPlayingTrack',
      (error) => {
        if (!isMounted.current) return

        console.error(
          '[useNowPlayingTrack] Error fetching current track:',
          error instanceof Error ? error.message : 'Unknown error'
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
        if (!isMounted.current) return
        console.error(
          '[useNowPlayingTrack] SWR Error:',
          err instanceof Error ? err.message : 'Unknown error'
        )
      },
      onSuccess: (data) => {
        if (!isMounted.current) return
        // Success logging is handled in the fetcher
      }
    }
  )

  return {
    data: data ?? undefined,
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
