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
  private pendingOperations: number = 0
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
    // Increment operation counter and pending count
    this.operationCount++
    this.pendingOperations++

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

    // Capture previous promise to wait for it safely
    const previousOperation = this.operationQueue

    // Create the new operation execution wrapper
    const currentOperationExecution = async () => {
      // 1. Wait for previous operation to settle (resolve OR reject)
      // We purposefully catch errors here to ensure the chain continues
      try {
        await previousOperation
      } catch {
        // Ignore previous error, it was handled by its own caller
      }

      // 2. Execute the current operation
      this.log('INFO', `[${operationName}] Starting operation`)
      try {
        await operation()
        this.log('INFO', `[${operationName}] Operation completed`)
      } finally {
        this.pendingOperations = Math.max(0, this.pendingOperations - 1)
      }
    }

    // 3. Start execution
    const executionPromise = currentOperationExecution()

    // 4. Update the queue pointer
    // We strictly want the queue to wait for this operation to finish, AND be successful (resolved)
    // for the NEXT item. But if this one fails, the NEXT item should still run (after this one finishes).
    // So operationQueue should always point to a RESOLVED promise when this one is done (even if failed).
    this.operationQueue = executionPromise.catch((err) => {
      this.log('ERROR', `[${operationName}] Operation failed`, err)
      // Return void to resolve the queue promise
    })

    // 5. Return the promise that actually rejects if operation failed (for the caller)
    return executionPromise
  }

  /**
   * Check if an operation is currently in progress
   * Useful for debugging and monitoring
   */
  isOperationInProgress(): boolean {
    return this.pendingOperations > 0
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
