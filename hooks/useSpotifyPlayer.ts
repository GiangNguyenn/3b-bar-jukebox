import { create } from 'zustand'
import { useCallback, useEffect, useRef } from 'react'
import { useConsoleLogsContext } from './ConsoleLogsProvider'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { playerLifecycleService } from '@/services/playerLifecycle'
import { PLAYER_LIFECYCLE_CONFIG } from '@/services/playerLifecycleConfig'

// Enhanced player status states
export type PlayerStatus =
  | 'initializing' // First-time setup
  | 'ready' // Fully connected and ready
  | 'reconnecting' // Lost connection, trying to recover
  | 'error' // Permanent error state
  | 'disconnected' // User manually disconnected
  | 'verifying' // Device verification in progress

interface PlayerStatusState {
  status: PlayerStatus
  lastStatusChange: number
  consecutiveFailures: number
  lastError?: string
  deviceId: string | null
  isReady: boolean // Keep for backward compatibility
  playbackState: SpotifyPlaybackState | null
  setStatus: (status: PlayerStatus, error?: string) => void
  setDeviceId: (deviceId: string | null) => void
  setPlaybackState: (state: SpotifyPlaybackState | null) => void
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
  verifying: ['ready', 'error', 'initializing', 'disconnected']
}

// Helper function to check if a transition is allowed
function isTransitionAllowed(from: PlayerStatus, to: PlayerStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

// Helper function to get isReady from status (for backward compatibility)
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

  setStatus: (newStatus, error) => {
    const currentState = get()
    const currentStatus = currentState.status

    // If it's the same status, just update the error if provided
    if (currentStatus === newStatus) {
      if (error !== undefined) {
        set({ lastError: error })
      }
      return
    }

    // Check if transition is allowed
    if (!isTransitionAllowed(currentStatus, newStatus)) {
      console.warn(
        `[PlayerState] Invalid transition from ${currentStatus} to ${newStatus}`
      )
      return
    }

    // Debounce rapid status changes (but allow certain important transitions)
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

    // Update state
    set({
      status: newStatus,
      lastStatusChange: Date.now(),
      lastError: error,
      isReady: getIsReadyFromStatus(newStatus)
    })
  },

  setDeviceId: (deviceId) => set({ deviceId }),
  setPlaybackState: (state) => set({ playbackState: state }),

  resetFailures: () => set({ consecutiveFailures: 0 }),
  incrementFailures: () => {
    const currentFailures = get().consecutiveFailures
    const newFailures = currentFailures + 1

    set({ consecutiveFailures: newFailures })

    // If we've exceeded max failures, transition to error state
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

// Export a hook to access the store
export function useSpotifyPlayerStore() {
  return spotifyPlayerStore()
}

// Separate hook for player actions with robust state management
export function useSpotifyPlayerHook(
  shouldDestroyOnUnmount = true,
  onNavigate?: (path: string) => void
) {
  const { addLog } = useConsoleLogsContext()

  // Set up logger for player lifecycle service
  useEffect(() => {
    playerLifecycleService.setLogger(addLog)
  }, [addLog])

  // Set up navigation callback if provided
  useEffect(() => {
    if (onNavigate) {
      playerLifecycleService.setNavigationCallback(onNavigate)
    }
  }, [onNavigate])

  const destroyPlayer = useCallback(() => {
    playerLifecycleService.destroyPlayer()
    spotifyPlayerStore.getState().setStatus('disconnected')
    spotifyPlayerStore.getState().setDeviceId(null)
    spotifyPlayerStore.getState().setPlaybackState(null)
  }, [])

  const createPlayer = useCallback(async () => {
    const currentPlayer = playerLifecycleService.getPlayer()
    const currentStatus = spotifyPlayerStore.getState().status

    // If we have a ready player, return the current device ID
    if (currentPlayer && currentStatus === 'ready') {
      addLog(
        'INFO',
        'Player already exists and is ready, returning current device ID',
        'SpotifyPlayer'
      )
      return spotifyPlayerStore.getState().deviceId
    }

    // If we have a player but it's not ready, destroy it first
    if (currentPlayer && currentStatus !== 'ready') {
      addLog(
        'INFO',
        'Player exists but not ready, destroying and recreating',
        'SpotifyPlayer'
      )
      destroyPlayer()
    }

    if (typeof window.Spotify === 'undefined') {
      addLog('ERROR', 'Spotify SDK not loaded', 'SpotifyPlayer')
      spotifyPlayerStore.getState().setStatus('error', 'Spotify SDK not loaded')
      return null
    }

    try {
      const deviceId = await playerLifecycleService.createPlayer(
        (status, error) => {
          spotifyPlayerStore.getState().setStatus(status as PlayerStatus, error)
        },
        (deviceId) => {
          spotifyPlayerStore.getState().setDeviceId(deviceId)
        },
        (state) => {
          spotifyPlayerStore.getState().setPlaybackState(state)
        }
      )

      return deviceId
    } catch (error) {
      addLog(
        'ERROR',
        'Error creating player',
        'SpotifyPlayer',
        error instanceof Error ? error : undefined
      )
      return null
    }
  }, [addLog, destroyPlayer])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (shouldDestroyOnUnmount) {
        destroyPlayer()
      }
    }
  }, [destroyPlayer, shouldDestroyOnUnmount])

  return {
    createPlayer,
    destroyPlayer
  }
}

// Admin-specific hook that never destroys the player
export function useAdminSpotifyPlayerHook(onNavigate?: (path: string) => void) {
  return useSpotifyPlayerHook(false, onNavigate)
}
