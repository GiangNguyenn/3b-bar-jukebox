import { useState, useCallback, useRef, useEffect } from 'react'
import { useSpotifyPlayer } from './useSpotifyPlayer'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'
import { useConsoleLogsContext } from './ConsoleLogsProvider'
import { useRecoverySystem } from './recovery/useRecoverySystem'
import { SpotifyApiService } from '@/services/spotifyApi'

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

const STALL_CHECK_INTERVAL = 5000 // 5 seconds
const MIN_STALLS_BEFORE_RECOVERY = 3
const DEVICE_MISMATCH_THRESHOLD = 3
const DEVICE_CHANGE_GRACE_PERIOD = 10000 // 10 seconds
const RECOVERY_COOLDOWN = 30000 // 30 seconds

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

  const deviceId = useSpotifyPlayer((state) => state.deviceId)
  const isReady = useSpotifyPlayer((state) => state.isReady)
  const playbackState = useSpotifyPlayer((state) => state.playbackState)
  const { addLog } = useConsoleLogsContext()
  
  // Refs for tracking state
  const deviceCheckInterval = useRef<NodeJS.Timeout | null>(null)
  const recoveryTimeout = useRef<NodeJS.Timeout | null>(null)
  const lastDeviceIdChange = useRef<number>(Date.now())
  const lastRecoverySuccess = useRef<number>(0)
  const lastConnectionStatus = useRef<string>('unknown')
  const addLogRef = useRef(addLog)
  const wasPlayingRef = useRef(false)
  const lastPlaybackCheckRef = useRef<number>(Date.now())
  const lastStallCheckRef = useRef<{ timestamp: number; count: number }>({
    timestamp: 0,
    count: 0
  })
  const deviceMismatchCountRef = useRef(0)
  const isInitialStateRef = useRef(true)

  // Update ref when addLog changes
  useEffect(() => {
    addLogRef.current = addLog
  }, [addLog])

  // Track playback state changes
  useEffect(() => {
    if (playbackState?.is_playing) {
      wasPlayingRef.current = true
      isInitialStateRef.current = false
    }
  }, [playbackState?.is_playing])

  // Track deviceId changes
  useEffect(() => {
    lastDeviceIdChange.current = Date.now()
    // Reset initial state when device changes
    isInitialStateRef.current = true
  }, [deviceId])

  // Use the unified recovery system with onSuccess callback
  const { recover } = useRecoverySystem(
    deviceId,
    fixedPlaylistId,
    useCallback((status) => {
      setHealthStatus((prev) => ({
        ...prev,
        device: status.device
      }))
    }, []),
    false,
    () => {
      lastRecoverySuccess.current = Date.now()
    }
  )

  // Device health check effect
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null
    let timeout: NodeJS.Timeout | null = null

    if (deviceCheckInterval.current) {
      clearInterval(deviceCheckInterval.current)
    }
    if (timeout) {
      clearTimeout(timeout)
    }

    const intervalDeviceId = deviceId
    timeout = setTimeout(() => {
      const checkDeviceHealth = async (): Promise<void> => {
        if (intervalDeviceId !== useSpotifyPlayer.getState().deviceId) {
          return
        }

        const now = Date.now()
        const timeSinceDeviceChange = now - lastDeviceIdChange.current
        const timeSinceLastRecovery = now - lastRecoverySuccess.current

        // Don't check health during grace periods
        if (timeSinceDeviceChange < DEVICE_CHANGE_GRACE_PERIOD || 
            timeSinceLastRecovery < RECOVERY_COOLDOWN) {
          return
        }

        const playbackState = useSpotifyPlayer.getState().playbackState
        if (!playbackState) {
          return
        }

        // Don't trigger recovery during initial state
        if (isInitialStateRef.current) {
          return
        }

        // Check for unexpected playback stops
        if (wasPlayingRef.current && !playbackState.is_playing) {
          addLogRef.current('WARN', 'Playback stopped unexpectedly', 'HealthMonitor', {
            deviceId: intervalDeviceId,
            timestamp: new Date().toISOString()
          } as any)
          setHealthStatus((prev) => ({ ...prev, device: 'unresponsive' }))
          void recover()
          return
        }

        // Check for device mismatch
        try {
          const spotifyApi = SpotifyApiService.getInstance()
          const state = await spotifyApi.getPlaybackState()

          if (state?.device?.id && state.device.id !== intervalDeviceId) {
            deviceMismatchCountRef.current += 1
            if (deviceMismatchCountRef.current >= DEVICE_MISMATCH_THRESHOLD) {
              addLogRef.current('WARN', 'Device mismatch detected', 'HealthMonitor', {
                expectedDeviceId: intervalDeviceId,
                actualDeviceId: state.device.id,
                timestamp: new Date().toISOString()
              } as any)
              void recover()
              deviceMismatchCountRef.current = 0
            }
          } else {
            deviceMismatchCountRef.current = 0
          }
        } catch (error) {
          if (error instanceof Error) {
            addLogRef.current('ERROR', 'Error checking device health', 'HealthMonitor', error)
          }
        }
      }

      checkDeviceHealth()
      interval = setInterval(() => {
        void checkDeviceHealth()
      }, DEVICE_CHECK_INTERVAL.unknown)
      deviceCheckInterval.current = interval
    }, DEVICE_CHANGE_GRACE_PERIOD)

    return (): void => {
      if (interval) {
        clearInterval(interval)
      }
      if (timeout) {
        clearTimeout(timeout)
      }
      if (deviceCheckInterval.current) {
        clearInterval(deviceCheckInterval.current)
      }
      if (recoveryTimeout.current) {
        clearTimeout(recoveryTimeout.current)
      }
    }
  }, [deviceId, recover])

  // Monitor connection quality
  useEffect(() => {
    const updateConnectionStatus = (): void => {
      if (!navigator.onLine) {
        if (lastConnectionStatus.current !== 'poor') {
          addLogRef.current('INFO', 'Device is offline', '[Connection]')
          setHealthStatus((prev) => ({ ...prev, connection: 'poor' }))
          lastConnectionStatus.current = 'poor'
        }
        return
      }

      const connection = (navigator as { connection?: NetworkInformation })
        .connection
      if (connection) {
        const { effectiveType, downlink, rtt } = connection
        let newStatus: 'good' | 'unstable' | 'poor' = 'good'

        if (connection.type === 'ethernet' || connection.type === 'wifi') {
          newStatus = 'good'
        } else if (
          effectiveType === '4g' &&
          downlink &&
          downlink >= 2 &&
          rtt &&
          rtt < 100
        ) {
          newStatus = 'good'
        } else if (effectiveType === '3g' && downlink && downlink >= 1) {
          newStatus = 'unstable'
        } else {
          newStatus = 'poor'
        }

        if (newStatus !== lastConnectionStatus.current) {
          addLogRef.current(
            'INFO',
            `Connection status changed to ${newStatus}`,
            '[Connection]'
          )
          setHealthStatus((prev) => ({ ...prev, connection: newStatus }))
          lastConnectionStatus.current = newStatus
        }
      } else {
        const newStatus = navigator.onLine ? 'good' : 'poor'
        if (newStatus !== lastConnectionStatus.current) {
          addLogRef.current(
            'INFO',
            `Connection status changed to ${newStatus}`,
            '[Connection]'
          )
          setHealthStatus((prev) => ({
            ...prev,
            connection: newStatus
          }))
          lastConnectionStatus.current = newStatus
        }
      }
    }

    // Initial check
    updateConnectionStatus()

    // Set up event listeners
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
  }, []) // Empty dependency array since we're using refs

  return { healthStatus, setHealthStatus }
}
