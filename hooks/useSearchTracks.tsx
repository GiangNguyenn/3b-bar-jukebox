import { useCallback, useState } from 'react'
import { sendApiRequest } from '../shared/api'
import { TrackDetails } from '@/shared/types'
import { ERROR_MESSAGES } from '@/shared/constants/errors'
import {
  handleApiError,
  handleOperationError,
  AppError
} from '@/shared/utils/errorHandling'

export interface SpotifySearchRequest {
  query: string
  type: string
  limit?: number
  offset?: number
  market?: string
}

export function useSearchTracks() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  const [tracks, setTracks] = useState<TrackDetails[]>([])

  const searchTracks = useCallback(
    async (request: SpotifySearchRequest) => {
      setIsLoading(true)
      setError(null)
      console.log('[Search] Making search request:', request)

      try {
        const queryParams = new URLSearchParams({
          q: request.query,
          type: request.type,
          ...(request.limit && { limit: request.limit.toString() }),
          ...(request.offset && { offset: request.offset.toString() }),
          ...(request.market && { market: request.market })
        })

        const response = await sendApiRequest<{ tracks: { items: TrackDetails[] } }>({
          path: `search?${queryParams.toString()}`,
          method: 'GET',
          extraHeaders: {
            'Content-Type': 'application/json'
          },
          retryConfig: {
            maxRetries: 3,
            baseDelay: 1000,
            maxDelay: 10000
          }
        })

        console.log('[Search] Received response:', response)
        setTracks(response.tracks.items)
      } catch (error) {
        console.error('[Search] Error in search request:', error)
        const appError = handleApiError(error, 'SearchTracks')
        setError(appError)
        setTracks([])
      } finally {
        setIsLoading(false)
      }
    },
    []
  )

  return {
    searchTracks,
    tracks,
    isLoading,
    error
  }
}
