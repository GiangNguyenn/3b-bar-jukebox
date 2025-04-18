import useSWR from 'swr'
import { sendApiRequest } from '../shared/api'
import { UserQueue } from '@/shared/types'
import { handleOperationError, AppError } from '@/shared/utils/errorHandling'
import { ERROR_MESSAGES } from '@/shared/constants/errors'

const userId = process.env.NEXT_PUBLIC_SPOTIFY_USER_ID ?? ''

export const useUserQueue = (id: string) => {
  const fetcher = async () => {
    return handleOperationError(
      async () => {
        const response = await sendApiRequest<UserQueue>({
          path: `me/player/queue`
        })
        return response
      },
      'UserQueue',
      (error) => {
        throw new AppError(ERROR_MESSAGES.FAILED_TO_LOAD, error, 'UserQueue')
      }
    )
  }

  const { data, error, mutate } = useSWR(`playlist ${id}`, fetcher)

  return {
    data,
    isLoading: !error && !data,
    error: error instanceof AppError ? error : null,
    refetchPlaylist: mutate
  }
}
