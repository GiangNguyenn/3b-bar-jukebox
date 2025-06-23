import { useState, useCallback, useRef, useEffect } from 'react'
import { useSpotifyPlayerStore, spotifyPlayerStore } from './useSpotifyPlayer'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { useConsoleLogsContext } from './ConsoleLogsProvider'
import { useRecoverySystem } from './recovery/useRecoverySystem'
import { SpotifyApiService } from '@/services/spotifyApi'
import { useFixedPlaylist } from './useFixedPlaylist'
import {
  setDeviceManagementLogger,
  validateDevice
} from '@/services/deviceManagement'
import { HealthStatus } from '@/shared/types/health'

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
const DEVICE_CHECK_DEBOUNCE = 2000 // 2 seconds debounce for device checks

const RECOVERY_STEPS = [
  { message: 'Refreshing player state...', weight: 0.2 },
  { message: 'Ensuring active device...', weight: 0.2 },
  { message: 'Attempting to reconnect...', weight: 0.3 },
  { message: 'Reinitializing player...', weight: 0.3 }
]

const MAX_RECOVERY_ATTEMPTS = 5
const BASE_DELAY = 2000 // 2 seconds

export function useSpotifyHealthMonitor(
  fixedPlaylistId: string | null,
  isFixedPlaylistLoading?: boolean,
  fixedPlaylistError?: Error | null
) {
  const [healthStatus, setHealthStatus] = useState<HealthStatus>({
    deviceId: null,
    device: 'unknown',
    playback: 'unknown',
    token: 'unknown',
    connection: 'unknown',
    tokenExpiringSoon: false,
    fixedPlaylist: 'unknown'
  })

  const { deviceId, isReady, playbackState } = useSpotifyPlayerStore()
  const { addLog } = useConsoleLogsContext()

  // Refs for tracking state
  const deviceCheckInterval = useRef<NodeJS.Timeout | null>(null)
  const recoveryTimeout = useRef<NodeJS.Timeout | null>(null)
  const lastDeviceIdChange = useRef<number>(Date.now())
  const lastRecoverySuccess = useRef<number>(0)
  const lastConnectionStatus = useRef<string>('unknown')
  const addLogRef = useRef(addLog)
  const wasPlayingRef = useRef(false)
  const deviceMismatchCountRef = useRef(0)
  const isInitialStateRef = useRef(true)
  const lastDeviceHealthCheckRef = useRef<number>(0)

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

  // Update device status when player becomes ready
  useEffect(() => {
    if (isReady && deviceId) {
      setHealthStatus((prev) => ({ ...prev, device: 'healthy' }))
      addLogRef.current('INFO', `Device ready: ${deviceId}`, 'HealthMonitor')
    } else if (!isReady && deviceId) {
      setHealthStatus((prev) => ({ ...prev, device: 'unknown' }))
    }
  }, [isReady, deviceId])

  // Update playlist status based on fixed playlist parameter
  useEffect(() => {
    if (isFixedPlaylistLoading) {
      // Still loading
      setHealthStatus((prev) => ({ ...prev, fixedPlaylist: 'unknown' }))
      return
    }

    if (fixedPlaylistError) {
      // Error occurred
      setHealthStatus((prev) => ({ ...prev, fixedPlaylist: 'error' }))
      addLogRef.current(
        'ERROR',
        `Fixed playlist error: ${fixedPlaylistError.message}`,
        'HealthMonitor'
      )
      return
    }

    if (fixedPlaylistId) {
      // Playlist found
      setHealthStatus((prev) => ({ ...prev, fixedPlaylist: 'found' }))
      addLogRef.current(
        'INFO',
        `Fixed playlist found: ${fixedPlaylistId}`,
        'HealthMonitor'
      )
    } else {
      // No playlist found
      setHealthStatus((prev) => ({ ...prev, fixedPlaylist: 'not_found' }))
      addLogRef.current('WARN', 'No fixed playlist found', 'HealthMonitor')
    }
  }, [fixedPlaylistId, isFixedPlaylistLoading, fixedPlaylistError])

  // Token validation effect
  useEffect(() => {
    const checkTokenStatus = async (): Promise<void> => {
      try {
        const response = await fetch('/api/token', {
          method: 'GET',
          cache: 'no-cache'
        })

        if (!response.ok) {
          addLogRef.current(
            'ERROR',
            `Token validation failed: ${response.status} ${response.statusText}`,
            'HealthMonitor'
          )
          setHealthStatus((prev) => ({ ...prev, token: 'error' }))
          return
        }

        const data = await response.json()
        const expiresSoonThreshold = 300 // 5 minutes

        if (data.expiresIn && data.expiresIn < expiresSoonThreshold) {
          setHealthStatus((prev) => ({
            ...prev,
            token: 'valid',
            tokenExpiringSoon: true
          }))
          addLogRef.current(
            'WARN',
            `Token expiring soon: ${data.expiresIn}s remaining`,
            'HealthMonitor'
          )
        } else {
          setHealthStatus((prev) => ({
            ...prev,
            token: 'valid',
            tokenExpiringSoon: false
          }))
        }
      } catch (error) {
        addLogRef.current(
          'ERROR',
          'Token validation error',
          'HealthMonitor',
          error instanceof Error ? error : undefined
        )
        setHealthStatus((prev) => ({ ...prev, token: 'error' }))
      }
    }

    // Check token status immediately and then every 30 seconds
    void checkTokenStatus()
    const interval = setInterval(checkTokenStatus, 30000)

    return () => clearInterval(interval)
  }, [])

  // Update playback status based on playback state
  useEffect(() => {
    addLogRef.current(
      'INFO',
      `Playback status effect: playbackState=${JSON.stringify(playbackState)}`,
      'HealthMonitor'
    )
    if (!playbackState) {
      setHealthStatus((prev) => ({ ...prev, playback: 'unknown' }))
      addLogRef.current(
        'INFO',
        'Set playback status to unknown',
        'HealthMonitor'
      )
      return
    }

    if (playbackState.is_playing) {
      setHealthStatus((prev) => ({ ...prev, playback: 'playing' }))
      addLogRef.current(
        'INFO',
        'Set playback status to playing',
        'HealthMonitor'
      )
    } else if (playbackState.item) {
      setHealthStatus((prev) => ({ ...prev, playback: 'paused' }))
      addLogRef.current(
        'INFO',
        'Set playback status to paused',
        'HealthMonitor'
      )
    } else {
      setHealthStatus((prev) => ({ ...prev, playback: 'stopped' }))
      addLogRef.current(
        'INFO',
        'Set playback status to stopped',
        'HealthMonitor'
      )
    }
  }, [playbackState])

  // Create a stable callback for the recovery system
  const onHealthUpdate = useCallback(() => {
    // Empty callback to avoid circular dependency
  }, [])

  // Use the unified recovery system with stable callback
  const { recover } = useRecoverySystem(
    deviceId,
    fixedPlaylistId,
    onHealthUpdate
  )

  // Device health monitoring effect
  useEffect(() => {
    if (!deviceId) {
      return
    }

    let interval: NodeJS.Timeout | null = null

    const timeout = setTimeout(() => {
      const checkDeviceHealth = async (): Promise<void> => {
        const intervalDeviceId = deviceId

        // Monitor device status using centralized device management
        try {
          if (!intervalDeviceId) {
            addLogRef.current(
              'WARN',
              'No device ID available for health check',
              'HealthMonitor'
            )
            return
          }

          // Debounce device health checks to prevent rapid error accumulation
          const now = Date.now()
          const timeSinceLastCheck = now - lastDeviceHealthCheckRef.current
          if (timeSinceLastCheck < DEVICE_CHECK_DEBOUNCE) {
            return
          }
          lastDeviceHealthCheckRef.current = now

          // Get current playback state for intelligent validation
          const state = await sendApiRequest<SpotifyPlaybackState>({
            path: 'me/player',
            method: 'GET'
          })

          // Use intelligent validation with context
          const validationResult = await validateDevice(intervalDeviceId)

          // Log warnings but don't count them as errors
          if (validationResult.warnings.length > 0) {
            addLogRef.current(
              'WARN',
              `Device warnings: ${validationResult.warnings.join(', ')}`,
              'HealthMonitor'
            )
          }

          if (!validationResult.isValid) {
            deviceMismatchCountRef.current += 1
            if (deviceMismatchCountRef.current >= DEVICE_MISMATCH_THRESHOLD) {
              addLogRef.current(
                'ERROR',
                `Device health check failed: ${validationResult.errors.join(', ')}`,
                'HealthMonitor'
              )
              const hasDeviceMismatch = validationResult.errors.some((error) =>
                error.includes('Device ID mismatch')
              )
              if (hasDeviceMismatch) {
                setHealthStatus((prev: HealthStatus) => ({
                  ...prev,
                  device: 'unresponsive'
                }))
                addLogRef.current(
                  'WARN',
                  'Another device is currently active - press play to transfer playback to jukebox',
                  'HealthMonitor'
                )
              } else {
                setHealthStatus((prev: HealthStatus) => ({
                  ...prev,
                  device: 'disconnected'
                }))
              }
              deviceMismatchCountRef.current = 0
            }
          } else {
            deviceMismatchCountRef.current = 0
            // Device is working properly, set status to healthy
            setHealthStatus((prev: HealthStatus) => ({
              ...prev,
              device: 'healthy'
            }))
          }
        } catch (error) {
          if (error instanceof Error) {
            addLogRef.current(
              'ERROR',
              `Error checking device health: ${error.message}`,
              'HealthMonitor',
              error
            )
          }
        }

        addLogRef.current(
          'INFO',
          `Device health check: playbackState=${JSON.stringify(playbackState)}`,
          'HealthMonitor'
        )
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
    const testConnection = async (): Promise<boolean> => {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 3000) // 3 second timeout

        const response = await fetch('/api/ping', {
          method: 'HEAD',
          signal: controller.signal,
          cache: 'no-store'
        })

        clearTimeout(timeoutId)
        return response.ok
      } catch (error) {
        return false
      }
    }

    const updateConnectionStatus = async (): Promise<void> => {
      const isConnected = await testConnection()
      const newStatus: 'connected' | 'disconnected' = isConnected
        ? 'connected'
        : 'disconnected'

      if (newStatus !== lastConnectionStatus.current) {
        addLogRef.current(
          'INFO',
          `Connection status changed to ${newStatus}`,
          '[Connection]'
        )
        setHealthStatus((prev) => ({ ...prev, connection: newStatus }))
        lastConnectionStatus.current = newStatus
      }
    }

    // Initial check
    updateConnectionStatus()

    // Set up periodic connection test (every 30 seconds)
    const connectionTestInterval = setInterval(() => {
      void updateConnectionStatus()
    }, 30000)

    return () => {
      clearInterval(connectionTestInterval)
    }
  }, []) // Empty dependency array since we're using refs

  // Set up device management logger
  useEffect(() => {
    setDeviceManagementLogger(addLog)
  }, [addLog])

  return { healthStatus, setHealthStatus }
}
