import { useState, useEffect } from 'react'
import { TrackItem } from '@/shared/types'
import { ERROR_MESSAGES } from '@/shared/constants/errors'
import { sendApiRequest } from '@/shared/api'
import { handleOperationError, AppError } from '@/shared/utils/errorHandling'

interface UseTrackOperationProps {
  playlistId: string | null
  playlistError?: boolean
  refetchPlaylist: () => Promise<void>
}

interface TrackOperationState {
  isLoading: boolean
  error: AppError | null
  isSuccess: boolean
}

type TrackOperation = (track: TrackItem) => Promise<void>

export const useTrackOperation = ({
  playlistId,
  playlistError = false,
  refetchPlaylist,
}: UseTrackOperationProps): TrackOperationState & {
  executeOperation: (
    operation: TrackOperation,
    track: TrackItem,
  ) => Promise<void>
} => {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<AppError | null>(() => {
    if (!playlistId)
      return new AppError(ERROR_MESSAGES.NO_PLAYLIST, null, 'TrackOperation')
    if (playlistError)
      return new AppError(ERROR_MESSAGES.FAILED_TO_LOAD, null, 'TrackOperation')
    return null
  })
  const [isSuccess, setIsSuccess] = useState(false)

  useEffect(() => {
    if (!playlistId) {
      setError(new AppError(ERROR_MESSAGES.NO_PLAYLIST, null, 'TrackOperation'))
      setIsSuccess(false)
    } else if (playlistError) {
      setError(
        new AppError(ERROR_MESSAGES.FAILED_TO_LOAD, null, 'TrackOperation'),
      )
      setIsSuccess(false)
    }
  }, [playlistId, playlistError])

  const executeOperation = async (
    operation: TrackOperation,
    track: TrackItem,
  ) => {
    if (!playlistId) {
      const error = new AppError(
        ERROR_MESSAGES.NO_PLAYLIST,
        null,
        'TrackOperation',
      )
      setError(error)
      setIsSuccess(false)
      throw error
    }

    if (playlistError) {
      const error = new AppError(
        ERROR_MESSAGES.FAILED_TO_LOAD,
        null,
        'TrackOperation',
      )
      setError(error)
      setIsSuccess(false)
      throw error
    }

    setIsLoading(true)
    setIsSuccess(false)

    try {
      await handleOperationError(
        async () => {
          await operation(track)
          await refetchPlaylist()
          setIsSuccess(true)
          setError(null)
        },
        'TrackOperation',
        (error) => {
          setError(error)
          setIsSuccess(false)
          throw error
        },
      )
    } finally {
      setIsLoading(false)
    }
  }

  return {
    isLoading,
    error,
    isSuccess,
    executeOperation,
  }
}
