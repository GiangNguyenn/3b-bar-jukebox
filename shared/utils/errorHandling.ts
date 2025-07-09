import { ERROR_MESSAGES, ErrorMessage } from '@/shared/constants/errors'
import { ErrorType } from '@/shared/types/recovery'

interface ApiError {
  message?: string
  error?: {
    message?: string
    status?: number
  }
  details?: {
    errorMessage?: string
  }
}

export class AppError extends Error {
  constructor(
    public message: ErrorMessage,
    public originalError?: unknown,
    public context?: string
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export const handleApiError = (error: unknown, context: string): AppError => {
  console.error(`[${context}] Error:`, error)

  if (error instanceof AppError) {
    return error
  }

  let errorMessage: ErrorMessage = ERROR_MESSAGES.GENERIC_ERROR

  if (error instanceof Error) {
    errorMessage = (error.message ||
      ERROR_MESSAGES.GENERIC_ERROR) as ErrorMessage
  } else if (typeof error === 'object' && error !== null) {
    const apiError = error as any
    let message =
      apiError.message ||
      apiError.error?.message ||
      apiError.details?.errorMessage ||
      apiError.error
    if (apiError.details) {
      message = `${message} - ${apiError.details}`
    }
    errorMessage = (message || ERROR_MESSAGES.GENERIC_ERROR) as ErrorMessage
  }

  return new AppError(errorMessage, error, context)
}

export const handleOperationError = async <T>(
  operation: () => Promise<T>,
  context: string,
  onError?: (error: AppError) => void
): Promise<T> => {
  try {
    return await operation()
  } catch (error) {
    const appError = handleApiError(error, context)
    onError?.(appError)
    throw appError
  }
}

export const isAppError = (error: unknown): error is AppError => {
  return error instanceof AppError
}

export function determineErrorType(error: unknown): ErrorType {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    if (
      message.includes('token') ||
      message.includes('auth') ||
      message.includes('unauthorized')
    ) {
      return ErrorType.AUTH
    }
    if (message.includes('device') || message.includes('transfer')) {
      return ErrorType.DEVICE
    }
    if (
      message.includes('connection') ||
      message.includes('network') ||
      message.includes('timeout')
    ) {
      return ErrorType.CONNECTION
    }
  }
  return ErrorType.PLAYBACK
}
