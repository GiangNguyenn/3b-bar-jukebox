import { useCallback, useEffect, useRef } from 'react'
import { useConsoleLogsContext } from './ConsoleLogsProvider'
import { playerLifecycleService } from '@/services/playerLifecycle'

// Re-export everything from the store so existing imports keep working
export type { PlayerStatus, PlayerStatusState } from './spotifyPlayerStore'
export { spotifyPlayerStore } from './spotifyPlayerStore'

import { spotifyPlayerStore } from './spotifyPlayerStore'
import type { PlayerStatus, PlayerStatusState } from './spotifyPlayerStore'

// The player creation in progress, shared by every caller (initial mount,
// auto-recovery, token refresh). Two creations at once would register two
// SDK players in one tab that fight over the Spotify account.
let inFlightCreate: Promise<string | null> | null = null

// Export a hook to access the store
export function useSpotifyPlayerStore(): PlayerStatusState {
  return spotifyPlayerStore()
}

// Separate hook for player actions with robust state management
export function useSpotifyPlayerHook(
  shouldDestroyOnUnmount = true,
  onNavigate?: (path: string) => void
): { createPlayer: () => Promise<string | null>; destroyPlayer: () => void } {
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
    // Clean up callback on unmount to prevent memory leaks
    return () => {
      playerLifecycleService.setNavigationCallback(null)
    }
  }, [onNavigate])

  const destroyPlayer = useCallback(() => {
    playerLifecycleService.destroyPlayer()
    spotifyPlayerStore.getState().setStatus('disconnected')
    spotifyPlayerStore.getState().setDeviceId(null)
    spotifyPlayerStore.getState().setPlaybackState(null)
  }, [])

  // Lets the recovery_needed callback go through the in-flight guard in
  // createPlayer, which is declared after this
  const createPlayerRef = useRef<() => Promise<string | null>>(() =>
    Promise.resolve(null)
  )

  const createPlayerOnce = useCallback(async (): Promise<string | null> => {
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
          // Check if we need to recover
          if (status === 'recovery_needed') {
            addLog(
              'WARN',
              'Player signaled recovery needed, recreating...',
              'SpotifyPlayer'
            )
            void (async () => {
              destroyPlayer()
              await new Promise((resolve) => setTimeout(resolve, 100))
              await createPlayerRef.current()
            })()
            return
          }

          // Validate status is a valid PlayerStatus before setting
          const validStatuses: PlayerStatus[] = [
            'initializing',
            'ready',
            'reconnecting',
            'error',
            'disconnected',
            'verifying'
          ]
          const validStatus = validStatuses.includes(status as PlayerStatus)
            ? (status as PlayerStatus)
            : 'error'
          spotifyPlayerStore.getState().setStatus(validStatus, error)
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

  const createPlayer = useCallback((): Promise<string | null> => {
    if (inFlightCreate) {
      addLog(
        'INFO',
        'Player creation already in progress, waiting for it',
        'SpotifyPlayer'
      )
      return inFlightCreate
    }
    const creation = createPlayerOnce().finally(() => {
      if (inFlightCreate === creation) inFlightCreate = null
    })
    inFlightCreate = creation
    return creation
  }, [addLog, createPlayerOnce])
  createPlayerRef.current = createPlayer

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
export function useAdminSpotifyPlayerHook(
  onNavigate?: (path: string) => void
): { createPlayer: () => Promise<string | null>; destroyPlayer: () => void } {
  return useSpotifyPlayerHook(false, onNavigate)
}
