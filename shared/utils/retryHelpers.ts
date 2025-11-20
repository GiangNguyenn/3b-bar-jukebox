/**
 * Calculates exponential backoff delay with jitter
 * Used for retry logic to prevent thundering herd and add randomness
 *
 * @param attempt - The current retry attempt number (0-indexed)
 * @param baseDelay - Base delay in milliseconds
 * @param maxDelay - Maximum delay in milliseconds
 * @returns Calculated delay in milliseconds
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number
): number {
  const exponentialDelay = baseDelay * Math.pow(2, attempt)
  const jitter = Math.random() * 0.3 * exponentialDelay // Add up to 30% jitter
  const delay = Math.min(exponentialDelay + jitter, maxDelay)
  return Math.floor(delay)
}
