// Shared configuration for player lifecycle management
export const PLAYER_LIFECYCLE_CONFIG = {
  // Grace periods (how long to wait before considering a state change permanent)
  GRACE_PERIODS: {
    notReadyToReconnecting: 3000, // 3 seconds before considering device lost
    reconnectingToError: 30000, // 30 seconds before giving up on reconnection
    verificationTimeout: 5000 // 5 seconds for device verification
  },
  // Retry limits
  MAX_CONSECUTIVE_FAILURES: 3,
  MAX_RECONNECTION_ATTEMPTS: 5,
  MAX_AUTH_RETRY_ATTEMPTS: 3,
  // Debounce intervals
  STATUS_DEBOUNCE: 500, // 500ms for status transitions
  // Queue thresholds
  QUEUE_LOW_THRESHOLD: 10, // Number of tracks before triggering auto-fill
  TRACK_END_THRESHOLD_MS: 500, // Milliseconds from track end to consider it finished (reduced from 1000ms)
  // Predictive track start thresholds
  TRACK_PREPARE_THRESHOLD_MS: 2500, // Start preparing 2.5s before end (reduced from 3000ms)
  TRACK_START_THRESHOLD_MS: 1000, // Start playing 1s before end (reduced from 1500ms)
  // Timeouts
  CLEANUP_TIMEOUT_MS: 5 * 60 * 1000, // 5 minutes
  SDK_RELOAD_TIMEOUT_MS: 10000, // 10 seconds
  INITIALIZATION_TIMEOUT_MS: 30000, // 30 seconds - strict timeout for player ready event
  // SDK Loading Configuration
  SDK_LOADING: {
    maxWaitMs: 20000, // 20 seconds
    checkIntervalMs: 100 // 100ms
  },
  // Issue #9: Additional constants for magic numbers
  PLAYBACK_RETRY: {
    initialBackoffMs: 500,
    maxBackoffMultiplier: 3, // Results in backoffs: 500ms, 1000ms, 2000ms
    maxAttempts: 10, // Maximum track attempts in playNextTrackImpl loop
    maxRetriesPerTrack: 3, // Maximum retries for a single track playback
    duplicateCheckRetries: 3, // Maximum retries when removing duplicates
    recoveryGracePeriodMs: 2000 // Grace period before triggering device recovery
  },
  STATE_MONITORING: {
    stallDetectionMs: 2000, // Time to wait before considering playback stalled
    nullStateThreshold: 3 // Number of consecutive null states before triggering recovery
  }
} as const

export type PlayerLifecycleConfig = typeof PLAYER_LIFECYCLE_CONFIG
