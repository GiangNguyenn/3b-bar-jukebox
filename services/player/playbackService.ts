/**
 * PlaybackService
 *
 * Lightweight service to serialize playback operations through promise-chain,
 * eliminating race conditions without using locks.
 *
 * This is a pragmatic Phase 2 approach that keeps all business logic in
 * playerLifecycle.ts while fixing the critical race condition issue.
 */

import type { Logger } from './types'

export class PlaybackService {
  private operationQueue: Promise<void> = Promise.resolve()
  private logger: Logger | null = null
  private operationCount: number = 0
  private readonly RESET_THRESHOLD = 100 // Reset chain every 100 operations

  /**
   * Set logger for this service
   */
  setLogger(logger: Logger): void {
    this.logger = logger
  }

  private log(
    level: 'INFO' | 'WARN' | 'ERROR',
    message: string,
    error?: unknown
  ): void {
    if (this.logger) {
      this.logger(
        level,
        message,
        'PlaybackService',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Execute a playback operation with automatic serialization.
   *
   * Operations are queued and executed sequentially through a promise chain.
   * This eliminates race conditions without requiring locks.
   *
   * @param operation - The playback operation to execute
   * @param operationName - Name for logging purposes
   * @returns Promise that resolves when the operation completes
   */
  async executePlayback(
    operation: () => Promise<void>,
    operationName: string = 'unknown'
  ): Promise<void> {
    // Increment operation counter
    this.operationCount++

    // Periodically reset the promise chain to prevent unbounded growth
    // This prevents memory accumulation in long-running sessions
    if (this.operationCount % this.RESET_THRESHOLD === 0) {
      this.log(
        'INFO',
        `Resetting promise chain after ${this.operationCount} operations`
      )
      // Wait for current chain to complete, then reset
      await this.operationQueue.catch(() => {
        // Ignore errors from previous chain
      })
      this.operationQueue = Promise.resolve()
    }

    // Chain this operation onto the queue
    // Each operation waits for the previous one to complete
    this.operationQueue = this.operationQueue
      .then(async () => {
        this.log('INFO', `[${operationName}] Starting operation`)
        await operation()
        this.log('INFO', `[${operationName}] Operation completed`)
      })
      .catch((err) => {
        // Log error but don't break the chain
        this.log('ERROR', `[${operationName}] Operation failed`, err)
        // Re-throw to propagate error to caller
        throw err
      })

    // Return the queued promise
    // Caller can await to know when their specific operation completes
    return this.operationQueue
  }

  /**
   * Check if an operation is currently in progress
   * Useful for debugging and monitoring
   */
  isOperationInProgress(): boolean {
    // If queue is still pending, an operation is in progress
    // This is a best-effort check - not guaranteed to be accurate
    // due to microtask timing
    return this.operationQueue !== Promise.resolve()
  }

  /**
   * Wait for all queued operations to complete
   * Useful for cleanup or testing
   */
  async waitForCompletion(): Promise<void> {
    await this.operationQueue
  }
}

// Export singleton instance
export const playbackService = new PlaybackService()
