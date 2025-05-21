import { SpotifyPlaybackState } from '../types'

/** Constants used throughout the recovery system */
export const RECOVERY_CONSTANTS = {
  /** Maximum number of consecutive failures before giving up */
  MAX_CONSECUTIVE_FAILURES: 5,
  /** Maximum number of recovery attempts before giving up */
  MAX_RECOVERY_ATTEMPTS: 3,
  /** Timeout for verification operations in milliseconds */
  VERIFICATION_TIMEOUT: 10000,
  /** Delay before cleaning up recovery state in milliseconds */
  CLEANUP_DELAY: 3000,
  /** Maximum valid playback position in milliseconds (1 hour) */
  MAX_PLAYBACK_POSITION: 3600000,
  /** Minimum valid playback position in milliseconds */
  MIN_PLAYBACK_POSITION: 0
} as const

/** Types of errors that can occur during recovery */
export enum ErrorType {
  /** Authentication related errors (token expired, invalid credentials) */
  AUTH = 'auth',
  /** Playback related errors (track not found, playback failed) */
  PLAYBACK = 'playback',
  /** Connection related errors (network issues, API unavailable) */
  CONNECTION = 'connection',
  /** Device related errors (device not found, transfer failed) */
  DEVICE = 'device'
}

/** Represents the current state of the recovery system */
export interface RecoveryState {
  /** Last known successful playback state */
  lastSuccessfulPlayback: {
    /** URI of the last successfully played track */
    trackUri: string | null
    /** Position in milliseconds where playback was last successful */
    position: number
    /** Timestamp when the last successful playback occurred */
    timestamp: number
  }
  /** Number of consecutive recovery failures */
  consecutiveFailures: number
  /** Type of the last error encountered */
  lastErrorType: ErrorType | null
}

/** Represents the current status of a recovery operation */
export interface RecoveryStatus {
  /** Whether a recovery operation is currently in progress */
  isRecovering: boolean
  /** Human-readable message describing the current recovery status */
  message: string
  /** Progress of the current recovery operation (0-100) */
  progress: number
  /** Current step in the recovery process */
  currentStep: number
  /** Total number of steps in the recovery process */
  totalSteps: number
}

/** Result of a playback verification operation */
export interface PlaybackVerificationResult {
  /** Whether the verification was successful */
  isSuccessful: boolean
  /** Reason for success or failure */
  reason?: string
  /** Detailed information about the verification result */
  details?: {
    /** Whether the current device matches the expected device */
    deviceMatch: boolean
    /** Whether playback is currently active */
    isPlaying: boolean
    /** Whether playback progress is advancing */
    progressAdvancing: boolean
    /** Whether the current context matches the expected context */
    contextMatch: boolean
    /** Name of the current track */
    currentTrack?: string
    /** Name of the expected track */
    expectedTrack?: string
    /** Timestamp when verification was performed */
    timestamp: number
    /** Duration of the verification process in milliseconds */
    verificationDuration: number
    /** Current volume level of the device */
    volumeLevel?: number
  }
}

/** State of device verification process */
export interface DeviceVerificationState {
  /** Whether device verification is currently in progress */
  isVerifying: boolean
  /** Timestamp of the last verification attempt */
  lastVerification: number
  /** Whether verification is currently locked */
  verificationLock: boolean
}

/** State of error recovery process */
export interface ErrorRecoveryState {
  /** Last error encountered */
  lastError: Error | null
  /** Number of errors encountered */
  errorCount: number
  /** Timestamp of the last recovery attempt */
  lastRecoveryAttempt: number
  /** Whether a recovery operation is currently in progress */
  recoveryInProgress: boolean
}

/** Result of a validation operation */
export interface ValidationResult {
  /** Whether the validation was successful */
  isValid: boolean
  /** List of validation errors */
  errors: string[]
  /** List of validation warnings */
  warnings: string[]
}

/** Represents a step in the recovery process */
export interface RecoveryStep {
  /** Human-readable message describing the step */
  message: string
  /** Weight of the step in progress calculation (0-1) */
  weight: number
}

/** Hook interface for the recovery system */
export interface RecoverySystemHook {
  /** Current status of the recovery system */
  recoveryStatus: RecoveryStatus
  /** Current state of the recovery system */
  recoveryState: RecoveryState
  /** Number of recovery attempts made */
  recoveryAttempts: number
  /** Function to attempt recovery */
  attemptRecovery: () => Promise<void>
  /** Function to update recovery state */
  setRecoveryState: (state: RecoveryState) => void
}

/** Validates a recovery state object */
export function validateRecoveryState(state: RecoveryState): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Validate position
  if (
    state.lastSuccessfulPlayback.position <
    RECOVERY_CONSTANTS.MIN_PLAYBACK_POSITION
  ) {
    errors.push('Invalid playback position: position cannot be negative')
  }
  if (
    state.lastSuccessfulPlayback.position >
    RECOVERY_CONSTANTS.MAX_PLAYBACK_POSITION
  ) {
    errors.push(
      'Invalid playback position: position exceeds maximum allowed duration'
    )
  }

  // Validate timestamp
  if (state.lastSuccessfulPlayback.timestamp > Date.now()) {
    warnings.push('Future timestamp detected in last successful playback')
  }
  if (state.lastSuccessfulPlayback.timestamp < 0) {
    errors.push('Invalid timestamp: timestamp cannot be negative')
  }

  // Validate consecutive failures
  if (state.consecutiveFailures < 0) {
    errors.push('Invalid failure count: count cannot be negative')
  }
  if (state.consecutiveFailures > RECOVERY_CONSTANTS.MAX_CONSECUTIVE_FAILURES) {
    warnings.push('Consecutive failures exceed recommended maximum')
  }

  // Validate track URI format if present
  if (
    state.lastSuccessfulPlayback.trackUri &&
    !state.lastSuccessfulPlayback.trackUri.startsWith('spotify:track:')
  ) {
    errors.push('Invalid track URI format')
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  }
}
