/**
 * RecoveryManager
 *
 * Lightweight service to manage authentication retry state and prevent retry storms.
 *
 * This is a pragmatic Phase 3 approach that centralizes retry tracking while keeping
 * all recovery flow logic in playerLifecycle.ts.
 *
 * Includes token suspension state and listener system to coordinate dependent
 * services when token recovery is exhausted.
 */

import type { Logger } from './types'
import type { EndpointFailureDetail } from '@/shared/types/token'
import { createModuleLogger } from '@/shared/utils/logger'

const log = createModuleLogger('RecoveryManager')

export class RecoveryManager {
  private failureCount = 0
  private lastAttemptTime = 0
  private logger: Logger | null = null

  // Token suspension state
  private isSuspended = false
  private suspendedAt: number | null = null
  private lastFailureDetails: EndpointFailureDetail[] = []
  private suspensionListeners: Set<(suspended: boolean) => void> = new Set()

  // Backoff recovery loop state
  private backoffTimer: ReturnType<typeof setTimeout> | null = null
  private static readonly INITIAL_BACKOFF_MS = 5000
  private static readonly MAX_BACKOFF_MS = 5 * 60 * 1000 // 5 minutes
  private static readonly MAX_RECOVERY_DURATION_MS = 30 * 60 * 1000 // 30 minutes

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

  /**
   * Check if a recovery attempt can be made.
   * Returns false if:
   * - Max retries exceeded
   * - Still in cooldown period
   */
  canAttemptRecovery(): boolean {
    if (this.failureCount >= this.maxRetries) {
      return false
    }

    if (this.isInCooldown()) {
      const remainingMs = this.cooldownMs - (Date.now() - this.lastAttemptTime)
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
  }

  /**
   * Record a successful recovery.
   * Resets failure count, cooldown, and clears suspension state.
   */
  recordSuccess(): void {
    if (this.failureCount > 0) {
      log('INFO', 'Recovery successful, clearing suspension state')
    }
    this.failureCount = 0
    this.lastAttemptTime = 0

    // Clear suspension state on success
    if (this.isSuspended) {
      this.isSuspended = false
      this.suspendedAt = null
      this.lastFailureDetails = []
      this.notifyListeners(false)
    }
  }

  /**
   * Get current retry count.
   * Useful for diagnostics and UI display.
   */
  getRetryCount(): number {
    return this.failureCount
  }

  /**
   * Reset retry state and suspension state.
   * Useful for manual recovery or cleanup.
   */
  reset(): void {
    this.failureCount = 0
    this.lastAttemptTime = 0

    // Clear backoff timer
    this.clearBackoffTimer()

    // Clear suspension state
    const wasSuspended = this.isSuspended
    this.isSuspended = false
    this.suspendedAt = null
    this.lastFailureDetails = []

    if (wasSuspended) {
      this.notifyListeners(false)
    }
  }

  // ─── Token Suspension State ─────────────────────────────────────────────

  /**
   * Check whether the system is in a token-suspended state.
   * Dependent services should check this before making API calls.
   */
  isTokenSuspended(): boolean {
    return this.isSuspended
  }

  /**
   * Subscribe to suspension state changes.
   * Returns an unsubscribe function.
   */
  onSuspensionChange(callback: (suspended: boolean) => void): () => void {
    this.suspensionListeners.add(callback)
    return () => {
      this.suspensionListeners.delete(callback)
    }
  }

  /**
   * Enter the suspended state when all token endpoints have failed
   * and recovery retries are exhausted. Notifies all listeners and
   * starts the backoff recovery loop.
   */
  enterSuspendedState(failureDetails: EndpointFailureDetail[]): void {
    // Clear any existing backoff loop to prevent duplicates
    this.clearBackoffTimer()

    this.isSuspended = true
    this.suspendedAt = Date.now()
    this.lastFailureDetails = failureDetails

    log(
      'WARN',
      `Entering token suspended state — ${failureDetails.length} endpoint(s) failed`
    )

    this.notifyListeners(true)
    this.startBackoffRecovery()
  }

  /**
   * Notify all registered suspension listeners of a state change.
   */
  private notifyListeners(suspended: boolean): void {
    this.suspensionListeners.forEach((listener) => {
      try {
        listener(suspended)
      } catch (err) {
        log(
          'ERROR',
          'Error in suspension listener callback',
          undefined,
          err as Error
        )
      }
    })
  }

  /**
   * Clear the backoff timer if one is running.
   */
  private clearBackoffTimer(): void {
    if (this.backoffTimer !== null) {
      clearTimeout(this.backoffTimer)
      this.backoffTimer = null
    }
  }

  /**
   * Start the exponential backoff recovery loop.
   * Schedule: 5s → 10s → 20s → 40s → ... capped at 5 minutes.
   * Uses lazy import of tokenManager to avoid circular dependency.
   */
  private startBackoffRecovery(): void {
    log('INFO', 'Starting exponential backoff recovery loop')

    let currentBackoffMs = RecoveryManager.INITIAL_BACKOFF_MS
    const recoveryStartTime = Date.now()

    const attemptRecovery = async () => {
      // Check if max recovery duration exceeded
      const elapsed = Date.now() - recoveryStartTime
      if (elapsed >= RecoveryManager.MAX_RECOVERY_DURATION_MS) {
        log(
          'ERROR',
          `Token recovery exceeded max duration (${RecoveryManager.MAX_RECOVERY_DURATION_MS / 60000} minutes) — giving up`
        )
        this.backoffTimer = null
        this.notifyListeners(true)
        return
      }

      // Check if we're still suspended (could have been reset externally)
      if (!this.isSuspended) {
        log('INFO', 'Recovery loop stopping — no longer suspended')
        this.backoffTimer = null
        return
      }

      try {
        // Lazy import to avoid circular dependency with tokenManager
        const { tokenManager } = await import('@/shared/token/tokenManager')
        const refreshed = await tokenManager.refreshIfNeeded()

        if (refreshed) {
          log('INFO', 'Backoff recovery succeeded — token refreshed')
          this.isSuspended = false
          this.suspendedAt = null
          this.lastFailureDetails = []
          this.backoffTimer = null
          this.recordSuccess()
          this.notifyListeners(false)
          return
        }

        // refreshIfNeeded returned false — token wasn't near expiry,
        // try getToken directly to force a refresh
        const token = await tokenManager.getToken()
        if (token) {
          log('INFO', 'Backoff recovery succeeded — token obtained')
          this.isSuspended = false
          this.suspendedAt = null
          this.lastFailureDetails = []
          this.backoffTimer = null
          this.recordSuccess()
          this.notifyListeners(false)
          return
        }
      } catch {
        log(
          'WARN',
          `Backoff recovery attempt failed, next retry in ${currentBackoffMs / 1000}s`
        )
      }

      // Schedule next attempt with exponential backoff
      const nextBackoff = currentBackoffMs
      currentBackoffMs = Math.min(
        currentBackoffMs * 2,
        RecoveryManager.MAX_BACKOFF_MS
      )
      this.backoffTimer = setTimeout(attemptRecovery, nextBackoff)
    }

    // Schedule the first attempt
    this.backoffTimer = setTimeout(attemptRecovery, currentBackoffMs)
  }

  // ─── Diagnostics ────────────────────────────────────────────────────────

  /**
   * Get diagnostics information
   */
  getDiagnostics(): {
    failureCount: number
    lastAttemptTime: number
    isInCooldown: boolean
    canAttemptRecovery: boolean
    isSuspended: boolean
    suspendedAt: number | null
    lastFailureDetails: EndpointFailureDetail[]
  } {
    return {
      failureCount: this.failureCount,
      lastAttemptTime: this.lastAttemptTime,
      isInCooldown: this.isInCooldown(),
      canAttemptRecovery: this.canAttemptRecovery(),
      isSuspended: this.isSuspended,
      suspendedAt: this.suspendedAt,
      lastFailureDetails: this.lastFailureDetails
    }
  }
}

// Export singleton instance
export const recoveryManager = new RecoveryManager()
