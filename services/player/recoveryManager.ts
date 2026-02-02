/**
 * RecoveryManager
 *
 * Lightweight service to manage authentication retry state and prevent retry storms.
 *
 * This is a pragmatic Phase 3 approach that centralizes retry tracking while keeping
 * all recovery flow logic in playerLifecycle.ts.
 */

import type { Logger } from './types'

export class RecoveryManager {
  private failureCount = 0
  private lastAttemptTime = 0
  private logger: Logger | null = null

  constructor(
    private readonly maxRetries: number = 3,
    private readonly cooldownMs: number = 5000
  ) {}

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
        'RecoveryManager',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Check if a recovery attempt can be made.
   * Returns false if:
   * - Max retries exceeded
   * - Still in cooldown period
   */
  canAttemptRecovery(): boolean {
    if (this.failureCount >= this.maxRetries) {
      this.log('WARN', `Max retries (${this.maxRetries}) exceeded`)
      return false
    }

    if (this.isInCooldown()) {
      const remainingMs = this.cooldownMs - (Date.now() - this.lastAttemptTime)
      this.log(
        'WARN',
        `In cooldown period (${Math.ceil(remainingMs / 1000)}s remaining)`
      )
      return false
    }

    return true
  }

  /**
   * Check if currently in cooldown period
   */
  private isInCooldown(): boolean {
    if (this.lastAttemptTime === 0) {
      return false
    }
    return Date.now() - this.lastAttemptTime < this.cooldownMs
  }

  /**
   * Record a recovery attempt (failure).
   * Increments failure count and sets cooldown timer.
   */
  recordAttempt(): void {
    this.failureCount++
    this.lastAttemptTime = Date.now()
    this.log(
      'INFO',
      `Recovery attempt recorded (count: ${this.failureCount}/${this.maxRetries})`
    )
  }

  /**
   * Record a successful recovery.
   * Resets failure count and cooldown.
   */
  recordSuccess(): void {
    if (this.failureCount > 0) {
      this.log(
        'INFO',
        `Recovery successful after ${this.failureCount} attempts - resetting state`
      )
    }
    this.failureCount = 0
    this.lastAttemptTime = 0
  }

  /**
   * Get current retry count.
   * Useful for diagnostics and UI display.
   */
  getRetryCount(): number {
    return this.failureCount
  }

  /**
   * Reset retry state.
   * Useful for manual recovery or cleanup.
   */
  reset(): void {
    this.log('INFO', 'Resetting recovery state')
    this.failureCount = 0
    this.lastAttemptTime = 0
  }

  /**
   * Get diagnostics information
   */
  getDiagnostics(): {
    failureCount: number
    lastAttemptTime: number
    isInCooldown: boolean
    canAttemptRecovery: boolean
  } {
    return {
      failureCount: this.failureCount,
      lastAttemptTime: this.lastAttemptTime,
      isInCooldown: this.isInCooldown(),
      canAttemptRecovery: this.canAttemptRecovery()
    }
  }
}

// Export singleton instance
export const recoveryManager = new RecoveryManager()
