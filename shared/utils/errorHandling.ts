import { ERROR_MESSAGES, ErrorMessage } from '@/shared/constants/errors'
import type { LogLevel } from '@/hooks/ConsoleLogsProvider'

export const ErrorType = {
  AUTH: 'auth',
  DEVICE: 'device',
  CONNECTION: 'connection',
  PLAYBACK: 'playback'
} as const
export type ErrorType = (typeof ErrorType)[keyof typeof ErrorType]

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

/**
 * Wraps an async operation with error handling that returns null on failure
 * instead of re-throwing. Use this for non-critical operations (queue updates,
 * cleanup) where the caller can tolerate null and log the failure.
 * For API operations where callers must handle errors, use handleOperationError.
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  context: string,
  logger?: (
    level: LogLevel,
    message: string,
    context?: string,
    error?: Error
  ) => void,
  onError?: (error: unknown) => void
): Promise<T | null> {
  try {
    return await operation()
  } catch (error) {
    const errorInstance =
      error instanceof Error ? error : new Error(String(error))
    if (logger) {
      logger('ERROR', `Error in ${context}`, context, errorInstance)
    } else {
      console.error(`[${context}] Error:`, errorInstance)
    }
    if (onError) {
      onError(error)
    }
    return null
  }
}

export function isPremiumRequiredError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return (
      message.includes('premium') ||
      message.includes('subscription') ||
      message.includes('upgrade') ||
      message.includes('account type') ||
      message.includes('not available for your account')
    )
  }
  return false
}
