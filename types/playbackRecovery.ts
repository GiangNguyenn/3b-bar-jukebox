/**
 * Type definitions for playback recovery system
 */

export type RecoveryStrategy =
  | 'resume_current'
  | 'play_next'
  | 'skip_to_next'
  | 'none'

export interface RecoveryResult {
  success: boolean
  strategy: RecoveryStrategy
  error?: Error
  nextAttemptAllowedAt?: number
  consecutiveFailures: number
}

export type PlaybackRecoveryState =
  | { type: 'idle' }
  | { type: 'checking'; lastStatus: string }
  | { type: 'recovering'; strategy: RecoveryStrategy; attempt: number }
  | { type: 'cooldown'; until: number }
  | { type: 'failed'; error: Error; consecutiveFailures: number }
