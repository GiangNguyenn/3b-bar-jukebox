/**
 * Shared error handling utilities for health monitoring hooks
 */

/**
 * Checks if an error is an AbortError (component unmounted)
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * Handles errors in health monitoring hooks
 * Silently handles AbortError (component unmounted)
 * Logs other errors using the provided logger
 */
export function handleHealthError(
  error: unknown,
  logger: (
    level: 'ERROR' | 'WARN' | 'INFO',
    message: string,
    context?: string,
    error?: Error
  ) => void,
  context: string,
  message: string
): void {
  // Handle AbortError silently (component unmounted)
  if (isAbortError(error)) {
    return
  }

  // Log other errors
  logger('ERROR', message, context, error instanceof Error ? error : undefined)
}
