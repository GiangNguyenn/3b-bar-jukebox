import { useState, useCallback, useRef, useEffect } from 'react'
import { useSpotifyPlayer } from './useSpotifyPlayer'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'
import { useConsoleLogsContext } from './ConsoleLogsProvider'
import { useRecoverySystem } from './recovery/useRecoverySystem'

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
  const deviceId = useSpotifyPlayer((state) => state.deviceId)
  const isReady = useSpotifyPlayer((state) => state.isReady)
  const playbackState = useSpotifyPlayer((state) => state.playbackState)
  const { addLog } = useConsoleLogsContext()
  const deviceCheckInterval = useRef<NodeJS.Timeout | null>(null)
  const recoveryTimeout = useRef<NodeJS.Timeout | null>(null)
  const lastDeviceIdChange = useRef<number>(Date.now())
  const lastRecoverySuccess = useRef<number>(0)

  // Use the unified recovery system with onSuccess callback
  const { recover } = useRecoverySystem(
    deviceId,
    fixedPlaylistId,
    () => {},
    false,
    () => {
      lastRecoverySuccess.current = Date.now()
    }
  )

  // Track deviceId changes for grace period
  useEffect(() => {
    lastDeviceIdChange.current = Date.now()
  }, [deviceId])

  // Device health check effect
  useEffect(() => {
    const GRACE_PERIOD_MS = 2000
    const POST_RECOVERY_GRACE_MS = 10000
    const HEALTH_CHECK_INTERVAL_MS = 10000 // Always 10 seconds
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
        const playbackState = useSpotifyPlayer.getState().playbackState
        // Only trigger recovery if playback is not progressing
        if (!playbackState || !playbackState.is_playing) {
          setHealthStatus((prev) => ({ ...prev, device: 'unresponsive' }))
          void recover()
          return
        }
        // No 'disconnected' state or logs
      }
      checkDeviceHealth()
      interval = setInterval(() => {
        void checkDeviceHealth()
      }, HEALTH_CHECK_INTERVAL_MS)
      deviceCheckInterval.current = interval
    }, 2000)
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
  }, [deviceId])

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
    attemptRecovery: recover
  }
}
