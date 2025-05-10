import { useState, useCallback, useRef, useEffect } from 'react'
import { useSpotifyPlayer } from './useSpotifyPlayer'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'
import { useConsoleLogs } from './useConsoleLogs'

// Network Information API types
interface NetworkInformation extends EventTarget {
  readonly type?:
    | 'bluetooth'
    | 'cellular'
    | 'ethernet'
    | 'none'
    | 'wifi'
    | 'wimax'
    | 'other'
    | 'unknown'
  readonly effectiveType?: 'slow-2g' | '2g' | '3g' | '4g'
  readonly downlink?: number
  readonly rtt?: number
  readonly saveData?: boolean
  onchange?: (this: NetworkInformation, ev: Event) => void
}

interface HealthStatus {
  device: 'healthy' | 'unresponsive' | 'disconnected' | 'unknown'
  playback: 'playing' | 'paused' | 'stopped' | 'error' | 'unknown'
  token: 'valid' | 'expired' | 'error' | 'unknown'
  connection: 'good' | 'unstable' | 'poor' | 'unknown'
  tokenExpiringSoon: boolean
  fixedPlaylist: 'found' | 'not_found' | 'error' | 'unknown'
}

interface RecoveryState {
  lastSuccessfulPlayback: {
    trackUri: string | null
    position: number
    timestamp: number
  }
  consecutiveFailures: number
  lastErrorType: 'auth' | 'playback' | 'connection' | 'device' | null
}

interface RecoveryStatus {
  isRecovering: boolean
  message: string
  progress: number
}

const DEVICE_CHECK_INTERVAL = {
  good: 30000, // 30 seconds
  unstable: 15000, // 15 seconds
  poor: 10000, // 10 seconds
  unknown: 5000 // 5 seconds for initial checks
}

const RECOVERY_STEPS = [
  { message: 'Refreshing player state...', weight: 0.2 },
  { message: 'Ensuring active device...', weight: 0.2 },
  { message: 'Attempting to reconnect...', weight: 0.3 },
  { message: 'Reinitializing player...', weight: 0.3 }
]

const MAX_RECOVERY_ATTEMPTS = 5
const BASE_DELAY = 2000 // 2 seconds

export function useSpotifyHealthMonitor(fixedPlaylistId: string | null) {
  const [healthStatus, setHealthStatus] = useState<HealthStatus>({
    device: 'unknown',
    playback: 'unknown',
    token: 'valid',
    connection: 'unknown',
    tokenExpiringSoon: false,
    fixedPlaylist: 'unknown'
  })
  const [recoveryAttempts, setRecoveryAttempts] = useState(0)
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus>({
    isRecovering: false,
    message: '',
    progress: 0
  })
  const [recoveryState, setRecoveryState] = useState<RecoveryState>({
    lastSuccessfulPlayback: {
      trackUri: null,
      position: 0,
      timestamp: 0
    },
    consecutiveFailures: 0,
    lastErrorType: null
  })

  const deviceId = useSpotifyPlayer((state) => state.deviceId)
  const isReady = useSpotifyPlayer((state) => state.isReady)
  const { addLog } = useConsoleLogs()
  const deviceCheckInterval = useRef<NodeJS.Timeout | null>(null)
  const recoveryTimeout = useRef<NodeJS.Timeout | null>(null)

  const attemptRecovery = useCallback(async (): Promise<void> => {
    if (recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
      console.error(
        '[Recovery] Max attempts reached, attempting final recovery...'
      )
      setRecoveryStatus({
        isRecovering: true,
        message: 'Attempting final recovery with stored state...',
        progress: 90
      })

      // Try one last recovery with stored state
      const lastState = recoveryState.lastSuccessfulPlayback
      if (lastState && Date.now() - lastState.timestamp < 300000) {
        try {
          console.log(
            '[Recovery] Attempting recovery with stored state:',
            lastState
          )
          await sendApiRequest({
            path: 'me/player/play',
            method: 'PUT',
            body: {
              context_uri: `spotify:playlist:${fixedPlaylistId}`,
              position_ms: lastState.position,
              offset: { uri: lastState.trackUri }
            }
          })
          setRecoveryAttempts(0)
          setRecoveryStatus({
            isRecovering: false,
            message: 'Recovery successful!',
            progress: 100
          })
          return
        } catch (error) {
          console.error('[Recovery] Final recovery attempt failed:', error)
        }
      }

      setRecoveryStatus({
        isRecovering: true,
        message: 'All recovery attempts failed. Reloading page...',
        progress: 100
      })
      setTimeout(() => {
        window.location.reload()
      }, 2000)
      return
    }

    try {
      setRecoveryStatus({
        isRecovering: true,
        message: 'Starting recovery process...',
        progress: 0
      })

      let currentProgress = 0
      const updateProgress = (step: number, success: boolean): void => {
        currentProgress += RECOVERY_STEPS[step].weight * 100
        setRecoveryStatus((prev) => ({
          ...prev,
          message: `${RECOVERY_STEPS[step].message} ${success ? '✓' : '✗'}`,
          progress: Math.min(currentProgress, 100)
        }))
      }

      // Step 1: Refresh player state
      if (typeof window.refreshSpotifyPlayer === 'function') {
        try {
          await window.refreshSpotifyPlayer()
          updateProgress(0, true)
        } catch (error) {
          console.error('[Recovery] Failed to refresh player state:', error)
          updateProgress(0, false)
          setRecoveryState((prev) => ({
            ...prev,
            consecutiveFailures: prev.consecutiveFailures + 1,
            lastErrorType: 'device'
          }))
        }
      }

      // Step 2: Ensure active device
      try {
        const currentState = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET'
        })

        if (!currentState?.device?.id) {
          if (deviceId) {
            await sendApiRequest({
              path: 'me/player',
              method: 'PUT',
              body: {
                device_ids: [deviceId],
                play: false
              }
            })
            await new Promise((resolve) => setTimeout(resolve, 1000))

            const newState = await sendApiRequest<SpotifyPlaybackState>({
              path: 'me/player',
              method: 'GET'
            })

            if (newState?.device?.id === deviceId) {
              updateProgress(1, true)
            } else {
              throw new Error('Device transfer failed')
            }
          } else {
            throw new Error('No device ID available')
          }
        } else {
          updateProgress(1, true)
        }
      } catch (error) {
        console.error('[Recovery] Failed to ensure active device:', error)
        updateProgress(1, false)
        setRecoveryState((prev) => ({
          ...prev,
          consecutiveFailures: prev.consecutiveFailures + 1,
          lastErrorType: 'device'
        }))
      }

      // Step 3: Reconnect player
      if (typeof window.spotifyPlayerInstance?.connect === 'function') {
        try {
          await window.spotifyPlayerInstance.connect()
          updateProgress(2, true)
        } catch (error) {
          console.error('[Recovery] Failed to reconnect player:', error)
          updateProgress(2, false)
          setRecoveryState((prev) => ({
            ...prev,
            consecutiveFailures: prev.consecutiveFailures + 1,
            lastErrorType: 'connection'
          }))
        }
      }

      // Step 4: Reinitialize player
      if (typeof window.initializeSpotifyPlayer === 'function') {
        try {
          const currentState = await sendApiRequest<SpotifyPlaybackState>({
            path: 'me/player',
            method: 'GET'
          })

          await window.initializeSpotifyPlayer()
          updateProgress(3, true)

          if (currentState?.item?.uri) {
            await sendApiRequest({
              path: 'me/player/play',
              method: 'PUT',
              body: {
                context_uri: `spotify:playlist:${fixedPlaylistId}`,
                position_ms: currentState.progress_ms ?? 0,
                offset: { uri: currentState.item.uri }
              },
              debounceTime: 60000
            })
          }
        } catch (error) {
          console.error('[Recovery] Failed to reinitialize player:', error)
          updateProgress(3, false)
          setRecoveryState((prev) => ({
            ...prev,
            consecutiveFailures: prev.consecutiveFailures + 1,
            lastErrorType: 'playback'
          }))
        }
      }

      setHealthStatus((prev) => ({ ...prev, device: 'healthy' }))
      setRecoveryAttempts(0)
      setRecoveryState((prev) => ({
        ...prev,
        consecutiveFailures: 0,
        lastErrorType: null
      }))
      setRecoveryStatus({
        isRecovering: false,
        message: 'Recovery successful!',
        progress: 100
      })

      setTimeout(() => {
        setRecoveryStatus({
          isRecovering: false,
          message: '',
          progress: 0
        })
      }, 3000)
    } catch (error) {
      console.error('[Recovery] Failed:', error)
      setRecoveryAttempts((prev) => prev + 1)
      setRecoveryState((prev) => ({
        ...prev,
        consecutiveFailures: prev.consecutiveFailures + 1,
        lastErrorType: 'playback'
      }))

      const delay = BASE_DELAY * Math.pow(2, recoveryAttempts)
      recoveryTimeout.current = setTimeout(() => {
        void attemptRecovery()
      }, delay)
    }
  }, [recoveryAttempts, fixedPlaylistId, deviceId])

  // Device health check effect
  useEffect(() => {
    const checkDeviceHealth = async (): Promise<void> => {
      if (!deviceId) {
        setHealthStatus((prev) => ({ ...prev, device: 'disconnected' }))
        void attemptRecovery()
        return
      }

      try {
        const state = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET'
        })

        if (!state?.device?.id) {
          setHealthStatus((prev) => ({ ...prev, device: 'disconnected' }))
          void attemptRecovery()
          return
        }

        if (isReady) {
          console.log('[Device] Player is ready, marking as healthy:', {
            deviceId,
            isReady,
            timestamp: Date.now()
          })
          setHealthStatus((prev) => ({ ...prev, device: 'healthy' }))
          setRecoveryAttempts(0)
          return
        }

        if (state.device.id !== deviceId) {
          console.log('[Device] Device ID mismatch:', {
            currentId: deviceId,
            reportedId: state.device.id,
            isReady,
            timestamp: Date.now()
          })
          setHealthStatus((prev) => ({ ...prev, device: 'disconnected' }))
          void attemptRecovery()
          return
        }

        setHealthStatus((prev) => ({ ...prev, device: 'unresponsive' }))
        void attemptRecovery()
      } catch (error) {
        console.error('[Device] Health check failed:', error)
        setHealthStatus((prev) => ({ ...prev, device: 'unresponsive' }))
        void attemptRecovery()
      }
    }

    const getCheckInterval = (): number => {
      return DEVICE_CHECK_INTERVAL[healthStatus.connection]
    }

    deviceCheckInterval.current = setInterval(() => {
      void checkDeviceHealth()
    }, getCheckInterval())

    return (): void => {
      if (deviceCheckInterval.current) {
        clearInterval(deviceCheckInterval.current)
      }
      if (recoveryTimeout.current) {
        clearTimeout(recoveryTimeout.current)
      }
    }
  }, [deviceId, healthStatus.connection, attemptRecovery, isReady])

  // Monitor connection quality
  useEffect(() => {
    const updateConnectionStatus = (): void => {
      if (!navigator.onLine) {
        console.log('[Connection] Device is offline')
        setHealthStatus((prev) => ({ ...prev, connection: 'poor' }))
        return
      }

      const connection = (navigator as { connection?: NetworkInformation })
        .connection
      if (connection) {
        const { effectiveType, downlink, rtt } = connection
        console.log('[Connection] Network info:', {
          effectiveType,
          downlink,
          rtt,
          type: connection.type
        })

        if (connection.type === 'ethernet' || connection.type === 'wifi') {
          console.log('[Connection] Using ethernet/wifi, marking as good')
          setHealthStatus((prev) => ({ ...prev, connection: 'good' }))
          return
        }

        if (
          effectiveType === '4g' &&
          downlink &&
          downlink >= 2 &&
          rtt &&
          rtt < 100
        ) {
          console.log('[Connection] Good 4G connection')
          setHealthStatus((prev) => ({ ...prev, connection: 'good' }))
        } else if (effectiveType === '3g' && downlink && downlink >= 1) {
          console.log('[Connection] Unstable 3G connection')
          setHealthStatus((prev) => ({ ...prev, connection: 'unstable' }))
        } else {
          console.log('[Connection] Poor connection')
          setHealthStatus((prev) => ({ ...prev, connection: 'poor' }))
        }
      } else {
        console.log(
          '[Connection] Network API not available, using online status'
        )
        setHealthStatus((prev) => ({
          ...prev,
          connection: navigator.onLine ? 'good' : 'poor'
        }))
      }
    }

    updateConnectionStatus()

    window.addEventListener('online', updateConnectionStatus)
    window.addEventListener('offline', updateConnectionStatus)

    const connection = (navigator as { connection?: NetworkInformation })
      .connection
    if (connection) {
      connection.addEventListener('change', updateConnectionStatus)
    }

    return () => {
      window.removeEventListener('online', updateConnectionStatus)
      window.removeEventListener('offline', updateConnectionStatus)
      if (connection) {
        connection.removeEventListener('change', updateConnectionStatus)
      }
    }
  }, [])

  return {
    healthStatus,
    recoveryStatus,
    recoveryAttempts,
    attemptRecovery
  }
}
