import { useState, useCallback, useRef, useEffect } from 'react'
import { useSpotifyPlayerStore, spotifyPlayerStore } from './useSpotifyPlayer'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'
import { useConsoleLogsContext } from './ConsoleLogsProvider'
import { useRecoverySystem } from './recovery/useRecoverySystem'
import { SpotifyApiService } from '@/services/spotifyApi'
import { useFixedPlaylist } from './useFixedPlaylist'
import {
  checkDeviceHealth as checkDeviceHealthService,
  setDeviceManagementLogger,
  validateDeviceStateIntelligent
} from '@/services/deviceManagement'

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
  recovery?: 'idle' | 'recovering' | 'completed' | 'failed'
  recoveryMessage?: string
  recoveryProgress?: number
  recoveryCurrentStep?: string
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
          const validation = validateDeviceStateIntelligent(
            intervalDeviceId,
            state,
            {
              isInitialSetup: isInitialStateRef.current,
              allowInactive: true,
              gracePeriodMs: DEVICE_CHANGE_GRACE_PERIOD,
              lastDeviceChange: lastDeviceIdChange.current
            }
          )

          // Log warnings but don't count them as errors
          if (validation.warnings.length > 0) {
            addLogRef.current(
              'WARN',
              `Device warnings: ${validation.warnings.join(', ')}`,
              'HealthMonitor'
            )
          }

          if (!validation.isValid) {
            deviceMismatchCountRef.current += 1
            if (deviceMismatchCountRef.current >= DEVICE_MISMATCH_THRESHOLD) {
              addLogRef.current(
                'ERROR',
                `Device health check failed: ${validation.errors.join(', ')}`,
                'HealthMonitor'
              )
              // Only log the mismatch, don't trigger recovery automatically
              setHealthStatus((prev) => ({ ...prev, device: 'disconnected' }))
              deviceMismatchCountRef.current = 0
            }
          } else {
            deviceMismatchCountRef.current = 0
            // Device is working properly, set status to healthy
            setHealthStatus((prev) => ({ ...prev, device: 'healthy' }))
          }

          // If validation suggests retry, reduce the mismatch count to give more time
          if (validation.shouldRetry) {
            deviceMismatchCountRef.current = Math.max(
              0,
              deviceMismatchCountRef.current - 1
            )
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
    // Simple connection test function
    const testConnection = async (): Promise<boolean> => {
      try {
        const startTime = Date.now()
        const response = await fetch('/api/ping', {
          method: 'GET',
          cache: 'no-cache',
          signal: AbortSignal.timeout(8000) // Increased timeout to 8 seconds
        })
        const endTime = Date.now()
        const responseTime = endTime - startTime

        addLogRef.current(
          'INFO',
          `Connection test: ${response.ok ? 'success' : 'failed'} (${responseTime}ms)`,
          '[Connection]'
        )

        // More lenient timeout - consider good if < 5 seconds (increased from 3)
        return response.ok && responseTime < 5000
      } catch (error) {
        addLogRef.current(
          'WARN',
          `Connection test failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          '[Connection]'
        )
        return false
      }
    }

    const updateConnectionStatus = async (): Promise<void> => {
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

      // Log connection information for debugging
      const connectionInfo = {
        type: connection?.type || 'unknown',
        effectiveType: connection?.effectiveType || 'unknown',
        downlink: connection?.downlink || 'unknown',
        rtt: connection?.rtt || 'unknown',
        saveData: connection?.saveData || false
      }

      addLogRef.current(
        'INFO',
        `Connection info: ${JSON.stringify(connectionInfo)}`,
        '[Connection]'
      )

      let newStatus: 'good' | 'unstable' | 'poor' = 'good'

      if (connection) {
        const { effectiveType, downlink, rtt } = connection

        // Ethernet and WiFi are always considered good
        if (connection.type === 'ethernet' || connection.type === 'wifi') {
          newStatus = 'good'
        }
        // 4G connections with reasonable performance
        else if (effectiveType && effectiveType.includes('4g')) {
          // More lenient 4G requirements
          const hasGoodDownlink = !downlink || downlink >= 1 // Reduced from 2 to 1 Mbps
          const hasGoodRTT = !rtt || rtt < 200 // Increased from 100 to 200ms

          if (hasGoodDownlink && hasGoodRTT) {
            newStatus = 'good'
          } else if (downlink && downlink >= 0.5) {
            // Very lenient downlink
            newStatus = 'unstable'
          } else {
            newStatus = 'poor'
          }
        }
        // 3G connections
        else if (effectiveType && effectiveType.includes('3g')) {
          if (downlink && downlink >= 0.5) {
            newStatus = 'unstable'
          } else {
            newStatus = 'poor'
          }
        }
        // 2G or slower connections
        else if (
          effectiveType &&
          (effectiveType.includes('2g') || effectiveType.includes('slow-2g'))
        ) {
          newStatus = 'poor'
        }
        // Unknown effective type but we have connection info
        else if (effectiveType) {
          // We have an effective type, but it's not one we explicitly handle
          // Assume good connection since we have connection information
          newStatus = 'good'
        }
        // No effective type but we have other connection info
        else if (downlink || rtt) {
          // If we have performance metrics, use them to determine quality
          const hasReasonableDownlink = !downlink || downlink >= 0.5
          const hasReasonableRTT = !rtt || rtt < 300

          if (hasReasonableDownlink && hasReasonableRTT) {
            newStatus = 'good'
          } else if (hasReasonableDownlink || hasReasonableRTT) {
            newStatus = 'unstable'
          } else {
            newStatus = 'poor'
          }
        }
        // No connection info available
        else {
          // If we're online but have no connection info, assume good
          // This is common in browsers that don't support NetworkInformation API
          newStatus = 'good'
        }
      } else {
        // No NetworkInformation API available, but we're online
        // Assume good connection since we're online
        newStatus = 'good'
      }

      // If we determined the connection should be good based on browser APIs,
      // verify it with an actual connection test
      if (newStatus === 'good') {
        // Only run connection test if this is not the initial check
        // This prevents blocking during initialization
        const isInitialCheck = lastConnectionStatus.current === 'unknown'

        if (!isInitialCheck) {
          const connectionTestPassed = await testConnection()
          if (!connectionTestPassed) {
            // If we have good connection metrics but the API test is slow,
            // only downgrade to unstable if we don't have strong connection indicators
            const hasStrongConnectionIndicators =
              connection?.type === 'ethernet' ||
              connection?.type === 'wifi' ||
              (connection?.effectiveType?.includes('4g') &&
                connection?.downlink &&
                connection.downlink >= 1.5)

            if (!hasStrongConnectionIndicators) {
              newStatus = 'unstable'
              addLogRef.current(
                'WARN',
                'Connection test failed and no strong connection indicators, downgrading to unstable',
                '[Connection]'
              )
            } else {
              addLogRef.current(
                'INFO',
                'Connection test slow but strong connection indicators present, keeping status as good',
                '[Connection]'
              )
            }
          }
        } else {
          addLogRef.current(
            'INFO',
            'Skipping connection test during initial check to avoid blocking initialization',
            '[Connection]'
          )
        }
      }

      if (newStatus !== lastConnectionStatus.current) {
        addLogRef.current(
          'INFO',
          `Connection status changed to ${newStatus} (type: ${connectionInfo.type}, effectiveType: ${connectionInfo.effectiveType})`,
          '[Connection]'
        )
        setHealthStatus((prev) => ({ ...prev, connection: newStatus }))
        lastConnectionStatus.current = newStatus
      }
    }

    // Initial check
    updateConnectionStatus()

    // Create stable function references for event listeners
    const handleOnline = () => void updateConnectionStatus()
    const handleOffline = () => void updateConnectionStatus()
    const handleConnectionChange = () => void updateConnectionStatus()

    // Set up event listeners
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    const connection = (navigator as { connection?: NetworkInformation })
      .connection
    if (connection) {
      connection.addEventListener('change', handleConnectionChange)
    }

    // Set up periodic connection test (every 30 seconds) - but delay the first one
    const connectionTestInterval = setInterval(() => {
      void updateConnectionStatus()
    }, 30000)

    // Run an initial connection test after a delay to avoid blocking initialization
    const initialConnectionTest = setTimeout(() => {
      void updateConnectionStatus()
    }, 5000) // Wait 5 seconds before first connection test

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      if (connection) {
        connection.removeEventListener('change', handleConnectionChange)
      }
      clearInterval(connectionTestInterval)
      clearTimeout(initialConnectionTest)
    }
  }, []) // Empty dependency array since we're using refs

  // Set up device management logger
  useEffect(() => {
    setDeviceManagementLogger(addLog)
  }, [addLog])

  return { healthStatus, setHealthStatus }
}
