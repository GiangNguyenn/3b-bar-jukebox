import { useState, useCallback, useRef, useEffect } from 'react'
import { useSpotifyPlayerStore, spotifyPlayerStore } from './useSpotifyPlayer'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'
import { useConsoleLogsContext } from './ConsoleLogsProvider'
import { useRecoverySystem } from './recovery/useRecoverySystem'
import { SpotifyApiService } from '@/services/spotifyApi'
import { useFixedPlaylist } from './useFixedPlaylist'

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
    fixedPlaylist: 'unknown',
    recovery: 'idle',
    recoveryMessage: '',
    recoveryProgress: 0,
    recoveryCurrentStep: ''
  })

  const { deviceId, isReady, playbackState } = useSpotifyPlayerStore()
  const { addLog } = useConsoleLogsContext()
  const { error: fixedPlaylistError, isLoading: isFixedPlaylistLoading, isInitialFetchComplete } = useFixedPlaylist()

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
  const lastProgressMsRef = useRef<number>(0)
  const lastProgressCheckRef = useRef<number>(Date.now())
  const progressStallCountRef = useRef(0)
  const userManuallyPausedRef = useRef(false)
  const manualPauseTimestampRef = useRef<number>(0)

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

  // Update playlist status based on fixed playlist hook
  useEffect(() => {
    if (!isInitialFetchComplete) {
      // Still loading
      setHealthStatus((prev) => ({ ...prev, fixedPlaylist: 'unknown' }))
      return
    }

    if (isFixedPlaylistLoading) {
      // Still loading
      setHealthStatus((prev) => ({ ...prev, fixedPlaylist: 'unknown' }))
      return
    }

    if (fixedPlaylistError) {
      // Error occurred
      setHealthStatus((prev) => ({ ...prev, fixedPlaylist: 'error' }))
      addLogRef.current('ERROR', `Fixed playlist error: ${fixedPlaylistError.message}`, 'HealthMonitor')
      return
    }

    if (fixedPlaylistId) {
      // Playlist found
      setHealthStatus((prev) => ({ ...prev, fixedPlaylist: 'found' }))
      addLogRef.current('INFO', `Fixed playlist found: ${fixedPlaylistId}`, 'HealthMonitor')
    } else {
      // No playlist found
      setHealthStatus((prev) => ({ ...prev, fixedPlaylist: 'not_found' }))
      addLogRef.current('WARN', 'No fixed playlist found', 'HealthMonitor')
    }
  }, [isInitialFetchComplete, isFixedPlaylistLoading, fixedPlaylistError, fixedPlaylistId])

  // Update playback status based on playback state
  useEffect(() => {
    addLogRef.current('INFO', `Playback status effect: playbackState=${JSON.stringify(playbackState)}`, 'HealthMonitor')
    if (!playbackState) {
      setHealthStatus((prev) => ({ ...prev, playback: 'unknown' }))
      addLogRef.current('INFO', 'Set playback status to unknown', 'HealthMonitor')
      return
    }

    if (playbackState.is_playing) {
      setHealthStatus((prev) => ({ ...prev, playback: 'playing' }))
      addLogRef.current('INFO', 'Set playback status to playing', 'HealthMonitor')
    } else if (playbackState.item) {
      setHealthStatus((prev) => ({ ...prev, playback: 'paused' }))
      addLogRef.current('INFO', 'Set playback status to paused', 'HealthMonitor')
    } else {
      setHealthStatus((prev) => ({ ...prev, playback: 'stopped' }))
      addLogRef.current('INFO', 'Set playback status to stopped', 'HealthMonitor')
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
        if (intervalDeviceId !== spotifyPlayerStore.getState().deviceId) {
          return
        }

        const now = Date.now()
        const timeSinceDeviceChange = now - lastDeviceIdChange.current
        const timeSinceLastRecovery = now - lastRecoverySuccess.current

        // Don't check health during grace periods
        if (
          timeSinceDeviceChange < DEVICE_CHANGE_GRACE_PERIOD ||
          timeSinceLastRecovery < RECOVERY_COOLDOWN
        ) {
          return
        }

        const playbackState = spotifyPlayerStore.getState().playbackState
        if (!playbackState) {
          return
        }

        // Don't trigger recovery during initial state
        if (isInitialStateRef.current) {
          return
        }

        // Check for unexpected playback stops (only automatic recovery trigger)
        if (wasPlayingRef.current && !playbackState.is_playing) {
          const timeSinceManualPause = now - manualPauseTimestampRef.current
          const wasRecentlyManuallyPaused = userManuallyPausedRef.current && timeSinceManualPause < 10000
          
          addLogRef.current(
            'INFO',
            `Playback stopped check: wasPlaying=${wasPlayingRef.current}, isPlaying=${playbackState.is_playing}, userManuallyPaused=${userManuallyPausedRef.current}, timeSinceManualPause=${timeSinceManualPause}ms, wasRecentlyManuallyPaused=${wasRecentlyManuallyPaused}`,
            'HealthMonitor'
          )
          
          // Only trigger recovery if the user didn't manually pause recently
          if (!wasRecentlyManuallyPaused) {
            addLogRef.current(
              'WARN',
              `Playback stopped unexpectedly (deviceId: ${intervalDeviceId})`,
              'HealthMonitor'
            )
            setHealthStatus((prev) => ({ ...prev, device: 'unresponsive' }))
            void recover()
            return
          } else {
            addLogRef.current(
              'INFO',
              `Playback was manually paused by user recently, not triggering recovery`,
              'HealthMonitor'
            )
            // Reset the manual pause flag since we've acknowledged it
            userManuallyPausedRef.current = false
            manualPauseTimestampRef.current = 0
          }
        }

        // Check if music is actually progressing when it should be playing
        if (wasPlayingRef.current && playbackState.is_playing && !userManuallyPausedRef.current) {
          const currentProgress = playbackState.progress_ms ?? 0
          const timeSinceLastCheck = now - lastProgressCheckRef.current

          // Check progress every 5 seconds
          if (timeSinceLastCheck >= 5000) {
            if (lastProgressMsRef.current > 0) {
              const progressDiff = currentProgress - lastProgressMsRef.current
              const expectedProgress = timeSinceLastCheck // timeSinceLastCheck is already in milliseconds
              
              addLogRef.current(
                'INFO',
                `Progress check: current=${currentProgress}, last=${lastProgressMsRef.current}, diff=${progressDiff}, expected=${expectedProgress}, threshold=${Math.round(expectedProgress * 0.8)}`,
                'HealthMonitor'
              )
              
              // If progress hasn't advanced by at least 80% of expected time, consider it stalled
              if (progressDiff < expectedProgress * 0.8) {
                const isNearEnd = playbackState.item?.duration_ms && 
                  (playbackState.item.duration_ms - currentProgress) < 5000
                
                if (!isNearEnd) {
                  progressStallCountRef.current += 1
                  addLogRef.current(
                    'WARN',
                    `Playback progress stalled (attempt ${progressStallCountRef.current}/3) (deviceId: ${intervalDeviceId}, progress: ${currentProgress}, expected: ~${Math.round(expectedProgress * 1000)})`,
                    'HealthMonitor'
                  )
                  
                  // Only trigger recovery after 3 consecutive stalls
                  if (progressStallCountRef.current >= 3) {
                    addLogRef.current(
                      'ERROR',
                      `Playback progress stalled 3 times consecutively, triggering recovery`,
                      'HealthMonitor'
                    )
                    setHealthStatus((prev) => ({ ...prev, device: 'unresponsive' }))
                    void recover()
                    progressStallCountRef.current = 0 // Reset counter after triggering recovery
                    return
                  }
                } else {
                  // Near end of track, reset stall count
                  progressStallCountRef.current = 0
                  addLogRef.current('INFO', 'Near end of track, resetting stall count', 'HealthMonitor')
                }
              } else {
                // Progress is normal, reset stall count
                if (progressStallCountRef.current > 0) {
                  addLogRef.current('INFO', 'Progress is normal, resetting stall count', 'HealthMonitor')
                }
                progressStallCountRef.current = 0
              }
            } else {
              addLogRef.current('INFO', 'First progress check, setting baseline', 'HealthMonitor')
            }
            
            lastProgressMsRef.current = currentProgress
            lastProgressCheckRef.current = now
          }
        }

        // Monitor device status without triggering recovery
        try {
          const spotifyApi = SpotifyApiService.getInstance()
          const state = await spotifyApi.getPlaybackState()

          if (state?.device?.id && state.device.id !== intervalDeviceId) {
            deviceMismatchCountRef.current += 1
            if (deviceMismatchCountRef.current >= DEVICE_MISMATCH_THRESHOLD) {
              addLogRef.current(
                'WARN',
                `Device mismatch detected (expected: ${intervalDeviceId}, actual: ${state.device.id})`,
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

        addLogRef.current('INFO', `Device health check: playbackState=${JSON.stringify(playbackState)}`, 'HealthMonitor')
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

  // Add function to signal manual pause/play actions
  const signalManualPlaybackAction = useCallback((action: 'pause' | 'play') => {
    addLogRef.current('INFO', `signalManualPlaybackAction called with action: ${action}`, 'HealthMonitor')
    
    if (action === 'pause') {
      userManuallyPausedRef.current = true
      manualPauseTimestampRef.current = Date.now()
      addLogRef.current('INFO', 'User manually paused playback - flag set to true', 'HealthMonitor')
    } else {
      userManuallyPausedRef.current = false
      addLogRef.current('INFO', 'User manually started playback - flag set to false', 'HealthMonitor')
    }
  }, [])

  return { healthStatus, setHealthStatus, signalManualPlaybackAction }
}
