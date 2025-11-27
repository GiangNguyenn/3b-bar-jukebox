/**
 * Utility functions for timestamp validation and processing
 */

/**
 * Validates if a timestamp represents a valid error timestamp
 * An error timestamp is valid if:
 * - lastError exists
 * - lastStatusChange exists and is greater than 0
 */
export function isValidErrorTimestamp(
  lastError: string | undefined,
  lastStatusChange: number | undefined
): boolean {
  return (
    lastError !== undefined &&
    lastStatusChange !== undefined &&
    lastStatusChange > 0
  )
}

/**
 * Validates if a timestamp represents a valid success timestamp
 * A success timestamp is valid if:
 * - playerStatus is 'ready'
 * - lastError is falsy
 * - lastStatusChange exists and is greater than 0
 */
export function isValidSuccessTimestamp(
  playerStatus: string,
  lastError: string | undefined,
  lastStatusChange: number | undefined
): boolean {
  return (
    playerStatus === 'ready' &&
    !lastError &&
    lastStatusChange !== undefined &&
    lastStatusChange > 0
  )
}

