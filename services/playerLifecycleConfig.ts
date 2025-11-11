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
  TRACK_END_THRESHOLD_MS: 1000, // Milliseconds from track end to consider it finished
  // Predictive track start thresholds
  TRACK_PREPARE_THRESHOLD_MS: 30000, // Start preparing 30s before end
  TRACK_START_THRESHOLD_MS: 5000, // Start playing 5s before end
  // Timeouts
  CLEANUP_TIMEOUT_MS: 5 * 60 * 1000, // 5 minutes
  SDK_RELOAD_TIMEOUT_MS: 10000 // 10 seconds
} as const

export type PlayerLifecycleConfig = typeof PLAYER_LIFECYCLE_CONFIG
