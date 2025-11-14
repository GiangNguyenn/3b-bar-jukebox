// Shared configuration for player lifecycle management
export const PLAYER_LIFECYCLE_CONFIG = {
  // Grace periods (how long to wait before considering a state change permanent)
  GRACE_PERIODS: {
    notReadyToReconnecting: 3000, // 3 seconds before considering device lost
    reconnectingToError: 15000, // 15 seconds before giving up on reconnection
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
  // Playback verification
  PLAYBACK_VERIFICATION_TIMEOUT_MS: 3000, // 3 seconds to verify playback started
  PLAYBACK_VERIFICATION_INTERVAL_MS: 200, // Poll every 200ms for verification
  // Transition retry
  MAX_TRANSITION_RETRIES: 3, // Maximum retry attempts for track transitions
  TRANSITION_LOCK_TIMEOUT_MS: 5000 // 5 seconds timeout for transition lock
} as const

export type PlayerLifecycleConfig = typeof PLAYER_LIFECYCLE_CONFIG
