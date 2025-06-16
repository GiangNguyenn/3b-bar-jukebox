import { useState, useEffect, useRef, useCallback } from 'react'
import { HealthStatus } from '@/shared/types'
import { useConsoleLogsContext } from '@/hooks/ConsoleLogsProvider'
import { SpotifyApiService } from '@/services/spotifyApi'
import { useRecoverySystem } from '@/hooks/recovery/useRecoverySystem'
import { useConnectionMonitor } from '@/shared/utils/connectionMonitor'
import {
  STALL_THRESHOLD,
  STALL_CHECK_INTERVAL,
  MIN_STALLS_BEFORE_RECOVERY,
  PROGRESS_TOLERANCE
} from '@/hooks/recovery/useRecoverySystem'

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

interface UseHealthMonitorProps {
  deviceId: string | null
  isReady: boolean
  isManualPause: boolean
  isInitializing: boolean
  playbackInfo: {
    progress: number
    progressStalled: boolean
  } | null
}

export function useHealthMonitor({
  deviceId,
  isReady,
  isManualPause,
  isInitializing,
  playbackInfo
}: UseHealthMonitorProps) {
  const [healthStatus, setHealthStatus] = useState<HealthStatus>({
    playback: 'paused',
    device: 'unknown',
    token: 'valid',
    connection: 'unknown',
    tokenExpiringSoon: false,
    fixedPlaylist: 'unknown'
  })

  const { addLog } = useConsoleLogsContext()
  const lastPlaybackCheckRef = useRef<number>(Date.now())
  const lastStallCheckRef = useRef<{ timestamp: number; count: number }>({
    timestamp: 0,
    count: 0
  })
  const deviceMismatchCountRef = useRef(0)
  const lastRecoveryTimeRef = useRef<number>(0)

  // Use the new connection monitor
  const connectionMetrics = useConnectionMonitor()

  const { recover } = useRecoverySystem(
    deviceId,
    null,
    useCallback((status) => {
      setHealthStatus((prev) => ({
        ...prev,
        device: status.device
      }))
    }, [])
  )

  // Update health status when connection metrics change
  useEffect(() => {
    setHealthStatus((prev) => ({
      ...prev,
      connection: connectionMetrics.status
    }))

    // Log connection changes
    addLog(
      'INFO',
      `[Connection] Status updated: ${connectionMetrics.status}, type=${connectionMetrics.type}, effectiveType=${connectionMetrics.effectiveType}, downlink=${connectionMetrics.downlink}Mbps, rtt=${connectionMetrics.rtt}ms`,
      'Connection',
      undefined
    )
  }, [connectionMetrics, addLog])

  // Health monitoring effect
  useEffect(() => {
    if (!deviceId || isInitializing) return

    const checkHealth = async () => {
      try {
        const spotifyApi = SpotifyApiService.getInstance()
        const currentState = await spotifyApi.getPlaybackState()

        if (!currentState) {
          addLog(
            'WARN',
            '[Health Monitor] Failed to get playback state, will retry',
            'Health Monitor',
            undefined
          )
          return
        }

        const now = Date.now()
        const gracePeriodMs = 3000
        if (
          lastRecoveryTimeRef.current &&
          now - lastRecoveryTimeRef.current < gracePeriodMs
        ) {
          return
        }

        const timeSinceLastCheck = now - lastPlaybackCheckRef.current
        lastPlaybackCheckRef.current = now

        // Update device status based on current state
        const newDeviceStatus = !deviceId
          ? 'disconnected'
          : !isReady
            ? 'unresponsive'
            : currentState.device?.id === deviceId
              ? 'healthy'
              : 'unresponsive'

        // Update playback status based on current state and manual pause
        const isActuallyPlaying = currentState.is_playing ?? false
        const newPlaybackStatus = !isReady
          ? 'paused'
          : isActuallyPlaying && !isManualPause
            ? 'playing'
            : 'paused'

        // Only update status if it has changed
        setHealthStatus((prev) => {
          if (prev.device === newDeviceStatus && prev.playback === newPlaybackStatus) {
            return prev
          }
          return {
            ...prev,
            device: newDeviceStatus,
            playback: newPlaybackStatus
          }
        })

        // Log status changes
        addLog(
          'INFO',
          `[Health Monitor] Status updated: device=${newDeviceStatus}, playback=${newPlaybackStatus}, deviceId=${deviceId}, isReady=${isReady}, timestamp=${new Date().toISOString()}`,
          'Health Monitor',
          undefined
        )

        // Stall detection logic
        if (
          isActuallyPlaying &&
          !isManualPause &&
          playbackInfo &&
          Math.abs(currentState.progress_ms - playbackInfo.progress) <
            PROGRESS_TOLERANCE &&
          timeSinceLastCheck > STALL_CHECK_INTERVAL
        ) {
          const lastStallCheck = lastStallCheckRef.current
          const timeSinceLastStallCheck = now - lastStallCheck.timestamp

          if (timeSinceLastStallCheck > STALL_THRESHOLD) {
            lastStallCheckRef.current = {
              timestamp: now,
              count: lastStallCheck.count + 1
            }

            if (
              lastStallCheck.count >= MIN_STALLS_BEFORE_RECOVERY - 1 &&
              !isManualPause
            ) {
              void recover()
              lastStallCheckRef.current = { timestamp: 0, count: 0 }
            }
          }
        }

        // Device mismatch detection
        if (!currentState.device?.id) {
          deviceMismatchCountRef.current += 1
          if (
            deviceMismatchCountRef.current >= 3 &&
            !isInitializing &&
            !isManualPause
          ) {
            void recover()
            deviceMismatchCountRef.current = 0
            lastRecoveryTimeRef.current = now
          }
        } else if (
          currentState.device.id !== deviceId &&
          !isInitializing &&
          !isManualPause
        ) {
          deviceMismatchCountRef.current += 1
          if (deviceMismatchCountRef.current >= 3) {
            void recover()
            deviceMismatchCountRef.current = 0
            lastRecoveryTimeRef.current = now
          }
        } else {
          deviceMismatchCountRef.current = 0
        }
      } catch (error) {
        addLog(
          'ERROR',
          `[Health Monitor] Error checking health: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'Health Monitor',
          error instanceof Error ? error : undefined
        )
        if (!isManualPause && !isInitializing) {
          void recover()
          lastRecoveryTimeRef.current = Date.now()
        }
      }
    }

    const intervalId = setInterval(checkHealth, 5000)
    return () => clearInterval(intervalId)
  }, [
    deviceId,
    isReady,
    isManualPause,
    isInitializing,
    playbackInfo,
    recover,
    addLog
  ])

  return {
    healthStatus,
    setHealthStatus
  }
} 