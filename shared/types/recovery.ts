import { SpotifyPlaybackState } from '../types'

export interface RecoveryState {
  lastSuccessfulPlayback: {
    trackUri: string | null
    position: number
    timestamp: number
  }
  consecutiveFailures: number
  lastErrorType: 'auth' | 'playback' | 'connection' | 'device' | null
}

export interface RecoveryStatus {
  isRecovering: boolean
  message: string
  progress: number
  currentStep: number
  totalSteps: number
}

export interface PlaybackVerificationResult {
  isSuccessful: boolean
  reason?: string
  details?: {
    deviceMatch: boolean
    isPlaying: boolean
    progressAdvancing: boolean
    contextMatch: boolean
    currentTrack?: string
    expectedTrack?: string
    timestamp: number
    verificationDuration: number
  }
}

export interface DeviceVerificationState {
  isVerifying: boolean
  lastVerification: number
  verificationLock: boolean
}

export interface ErrorRecoveryState {
  lastError: Error | null
  errorCount: number
  lastRecoveryAttempt: number
  recoveryInProgress: boolean
}

export interface ValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
}

export interface RecoveryStep {
  message: string
  weight: number
}

export type ErrorType = 'auth' | 'playback' | 'connection' | 'device'

export interface RecoverySystemHook {
  recoveryStatus: RecoveryStatus
  recoveryState: RecoveryState
  recoveryAttempts: number
  attemptRecovery: () => Promise<void>
  setRecoveryState: (state: RecoveryState) => void
} 