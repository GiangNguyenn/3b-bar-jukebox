import { useCallback, useState } from 'react'
import { TrackDetails } from '@/shared/types/spotify'
import { ERROR_MESSAGES } from '@/shared/constants/errors'
import {
  handleApiError,
  handleOperationError,
  AppError
} from '@/shared/utils/errorHandling'

export interface SpotifySearchRequest {
  query: string
  type?: string
  limit?: number
  offset?: number
  market?: string
}

export function useSearchTracks() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  const [tracks, setTracks] = useState<TrackDetails[]>([])

  const searchTracks = useCallback(async (request: SpotifySearchRequest) => {
    if (!request.query.trim()) {
      setTracks([])
      return
    }

    setIsLoading(true)
    setError(null)
    console.log('[Search] Making search request:', request)

    try {
      const queryParams = new URLSearchParams({
        q: request.query,
        type: request.type || 'track',
        ...(request.limit && { limit: request.limit.toString() }),
        ...(request.offset && { offset: request.offset.toString() }),
        ...(request.market && { market: request.market })
      })

      const response = await fetch(`/api/search?${queryParams.toString()}`)
      if (!response.ok) {
        const errorData = await response.json()
        throw new AppError(errorData.error, errorData.details, 'SearchTracks')
      }

      const data = await response.json()
      console.log('[Search] Received response:', data)
      setTracks(data.tracks.items)
    } catch (error) {
      console.error('[Search] Error in search request:', error)
      const appError = handleApiError(error, 'SearchTracks')
      setError(appError)
      setTracks([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  return {
    searchTracks,
    tracks,
    setTracks,
    isLoading,
    error
  }
}
