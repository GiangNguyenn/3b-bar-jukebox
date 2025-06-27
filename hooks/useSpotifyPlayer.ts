// @ts-nocheck - Spotify SDK type definitions are incomplete and incompatible with our types
import { create } from 'zustand'
import { useCallback, useEffect, useRef } from 'react'
import { useConsoleLogsContext } from './ConsoleLogsProvider'
import { showToast } from '@/lib/toast'
import { sendApiRequest } from '@/shared/api'
import {
  SpotifyPlaybackState,
  SpotifySDKPlaybackState,
  SpotifyPlayerInstance,
  SpotifySDK
} from '@/shared/types/spotify'
import {
  validateDevice,
  transferPlaybackToDevice,
  cleanupOtherDevices,
  setDeviceManagementLogger
} from '@/services/deviceManagement'
import { playerLifecycleService } from '@/services/playerLifecycle'

type SpotifySDKEventTypes =
  | 'ready'
  | 'not_ready'
  | 'player_state_changed'
  | 'initialization_error'
  | 'authentication_error'
  | 'account_error'
  | 'playback_error'

type SpotifySDKEventCallbacks = {
  ready: (event: { device_id: string }) => void
  not_ready: (event: { device_id: string }) => void
  player_state_changed: (state: SpotifySDKPlaybackState) => void
  initialization_error: (event: { message: string }) => void
  authentication_error: (event: { message: string }) => void
  account_error: (event: { message: string }) => void
  playback_error: (event: { message: string }) => void
}

// @ts-ignore - Spotify SDK type definitions are incomplete
declare global {
  interface Window {
    Spotify: typeof Spotify
    spotifyPlayerInstance: any // Use any to avoid type conflicts
  }
}

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
      timeSinceLastChange < STATE_MACHINE_CONFIG.STATUS_DEBOUNCE &&
      !isImportantTransition
    ) {
      console.log(
        `[PlayerState] Debouncing status change from ${currentStatus} to ${newStatus} (${timeSinceLastChange}ms since last change)`
      )
      return
    }

    // Log important transitions that bypass debouncing
    if (
      isImportantTransition &&
      timeSinceLastChange < STATE_MACHINE_CONFIG.STATUS_DEBOUNCE
    ) {
      console.log(
        `[PlayerState] Allowing important transition from ${currentStatus} to ${newStatus} despite debounce (${timeSinceLastChange}ms)`
      )
    }

    // Update state
    set({
      status: newStatus,
      lastStatusChange: Date.now(),
      lastError: error,
      isReady: getIsReadyFromStatus(newStatus)
    })

    console.log(
      `[PlayerState] Status changed: ${currentStatus} → ${newStatus}${error ? ` (Error: ${error})` : ''}`
    )
  },

  setDeviceId: (deviceId) => set({ deviceId }),
  setPlaybackState: (state) => set({ playbackState: state }),

  resetFailures: () => set({ consecutiveFailures: 0 }),
  incrementFailures: () => {
    const currentFailures = get().consecutiveFailures
    const newFailures = currentFailures + 1

    set({ consecutiveFailures: newFailures })

    // If we've exceeded max failures, transition to error state
    if (newFailures >= STATE_MACHINE_CONFIG.MAX_CONSECUTIVE_FAILURES) {
      get().setStatus(
        'error',
        `Exceeded maximum consecutive failures (${newFailures})`
      )
    }

    return newFailures
  }
}))

// Subscribe to the store to react to state changes
spotifyPlayerStore.subscribe((state, prevState) => {
  console.log('Player state changed:', {
    isPlaying: state.playbackState?.is_playing,
    wasPlaying: prevState.playbackState?.is_playing
  })
  // Check if playback has just resumed
  if (state.playbackState?.is_playing && !prevState.playbackState?.is_playing) {
    try {
      console.log('Showing toast')
      showToast('Playback resumed', 'success')
    } catch (error) {
      console.error('Error showing toast:', error)
    }
  }
})

// Export a hook to access the store
export function useSpotifyPlayerStore() {
  return spotifyPlayerStore()
}

// Separate hook for player actions with robust state management
export function useSpotifyPlayerHook(shouldDestroyOnUnmount = true) {
  const { addLog } = useConsoleLogsContext()
  const isUnmountingRef = useRef(false)

  // Set up logger for player lifecycle service
  useEffect(() => {
    playerLifecycleService.setLogger(addLog)
  }, [addLog])

  const destroyPlayer = useCallback(() => {
    if (!isUnmountingRef.current) {
      playerLifecycleService.destroyPlayer()
      spotifyPlayerStore.getState().setStatus('disconnected')
      spotifyPlayerStore.getState().setDeviceId(null)
      spotifyPlayerStore.getState().setPlaybackState(null)
    }
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
      // Don't set status here - the player lifecycle service will handle it
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
      addLog('ERROR', 'Error creating player:', error)
      return null
    }
  }, [addLog, destroyPlayer])

  // Cleanup on unmount - only destroy when component is actually unmounting and shouldDestroyOnUnmount is true
  useEffect(() => {
    return () => {
      isUnmountingRef.current = true
      // Only destroy player on actual unmount if shouldDestroyOnUnmount is true
      if (typeof window !== 'undefined' && shouldDestroyOnUnmount) {
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
export function useAdminSpotifyPlayerHook() {
  return useSpotifyPlayerHook(false)
}

// State machine configuration
const STATE_MACHINE_CONFIG = {
  // Grace periods (how long to wait before considering a state change permanent)
  GRACE_PERIODS: {
    notReadyToReconnecting: 3000, // 3 seconds before considering device lost
    reconnectingToError: 15000, // 15 seconds before giving up on reconnection
    verificationTimeout: 5000 // 5 seconds for device verification (reduced from 10)
  },
  // Retry limits
  MAX_CONSECUTIVE_FAILURES: 3,
  MAX_RECONNECTION_ATTEMPTS: 5,
  // Debounce intervals
  STATUS_DEBOUNCE: 500 // Reduced from 1000ms to 500ms for faster transitions
} as const

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
