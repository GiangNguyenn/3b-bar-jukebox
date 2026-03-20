/**
 * Zustand store for Spotify player state.
 *
 * Extracted into its own file to avoid circular dependencies:
 *   QueueSynchronizer → useSpotifyPlayer → playerLifecycle → QueueSynchronizer
 *
 * This file has NO imports from playerLifecycle or QueueSynchronizer.
 */
import { create } from 'zustand'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { PLAYER_LIFECYCLE_CONFIG } from '@/services/playerLifecycleConfig'

// Enhanced player status states
export type PlayerStatus =
  | 'initializing' // First-time setup
  | 'ready' // Fully connected and ready
  | 'reconnecting' // Lost connection, trying to recover
  | 'error' // Permanent error state
  | 'disconnected' // User manually disconnected
  | 'verifying' // Device verification in progress
  | 'recovery_needed' // Signal to UI that player needs to be recreated

export interface PlayerStatusState {
  status: PlayerStatus
  lastStatusChange: number
  consecutiveFailures: number
  lastError?: string
  deviceId: string | null
  isReady: boolean // Keep for backward compatibility
  playbackState: SpotifyPlaybackState | null
  isTransitionInProgress: boolean
  setStatus: (status: PlayerStatus, error?: string) => void
  setDeviceId: (deviceId: string | null) => void
  setPlaybackState: (state: SpotifyPlaybackState | null) => void
  setIsTransitionInProgress: (value: boolean) => void
  resetFailures: () => void
  incrementFailures: () => void
}

// State transition rules
const ALLOWED_TRANSITIONS: Record<PlayerStatus, PlayerStatus[]> = {
  initializing: ['ready', 'error', 'verifying', 'disconnected'],
  ready: ['reconnecting', 'error', 'disconnected', 'initializing'],
  reconnecting: ['ready', 'error', 'initializing'],
  error: ['initializing', 'ready', 'disconnected'],
  disconnected: ['initializing', 'ready'],
  verifying: ['ready', 'error', 'initializing', 'disconnected'],
  recovery_needed: ['initializing', 'error', 'disconnected']
}

function isTransitionAllowed(from: PlayerStatus, to: PlayerStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

function getIsReadyFromStatus(status: PlayerStatus): boolean {
  return status === 'ready'
}

// Create the store with robust state management
export const spotifyPlayerStore = create<PlayerStatusState>((set, get) => ({
  status: 'initializing',
  lastStatusChange: 0,
  consecutiveFailures: 0,
  deviceId: null,
  isReady: false,
  playbackState: null,
  isTransitionInProgress: false,

  setStatus: (newStatus, error) => {
    const currentState = get()
    const currentStatus = currentState.status

    if (currentStatus === newStatus) {
      if (error !== undefined) {
        set({ lastError: error })
      }
      return
    }

    if (!isTransitionAllowed(currentStatus, newStatus)) {
      console.warn(
        `[PlayerState] Invalid transition from ${currentStatus} to ${newStatus}`
      )
      return
    }

    const timeSinceLastChange = Date.now() - currentState.lastStatusChange
    const isImportantTransition =
      (currentStatus === 'verifying' && newStatus === 'ready') ||
      (currentStatus === 'initializing' && newStatus === 'verifying')

    if (
      timeSinceLastChange < PLAYER_LIFECYCLE_CONFIG.STATUS_DEBOUNCE &&
      !isImportantTransition
    ) {
      return
    }

    set({
      status: newStatus,
      lastStatusChange: Date.now(),
      lastError: error,
      isReady: getIsReadyFromStatus(newStatus)
    })
  },

  setDeviceId: (deviceId) => set({ deviceId }),
  setPlaybackState: (state) => set({ playbackState: state }),
  setIsTransitionInProgress: (value) => set({ isTransitionInProgress: value }),

  resetFailures: () => set({ consecutiveFailures: 0 }),
  incrementFailures: () => {
    const currentFailures = get().consecutiveFailures
    const newFailures = currentFailures + 1
    set({ consecutiveFailures: newFailures })
    if (newFailures >= PLAYER_LIFECYCLE_CONFIG.MAX_CONSECUTIVE_FAILURES) {
      get().setStatus(
        'error',
        `Exceeded maximum consecutive failures (${newFailures})`
      )
    }
    return newFailures
  }
}))

// Subscribe to the store to react to state changes
spotifyPlayerStore.subscribe(() => {
  // Note: Removed duplicate "Playback resumed" toast notification
  // The SpotifyApiService.resumePlayback() method already handles this notification
})
