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
  }, [connectionMetrics.status])

  // Monitor playback health
  useEffect(() => {
    if (!deviceId || !playbackInfo || isInitializing) return

    const checkPlaybackHealth = async () => {
      const now = Date.now()
      const timeSinceLastCheck = now - lastPlaybackCheckRef.current

      // Check for stalls
      if (playbackInfo.progressStalled) {
        const { timestamp, count } = lastStallCheckRef.current
        if (now - timestamp > STALL_CHECK_INTERVAL) {
          lastStallCheckRef.current = {
            timestamp: now,
            count: count + 1
          }

          if (count + 1 >= MIN_STALLS_BEFORE_RECOVERY) {
            void recover()
            lastStallCheckRef.current = { timestamp: now, count: 0 }
          }
        }
      } else {
        lastStallCheckRef.current = { timestamp: now, count: 0 }
      }

      // Check for device mismatch
      try {
        const spotifyApi = SpotifyApiService.getInstance()
        const state = await spotifyApi.getPlaybackState()

        if (
          state?.device?.id &&
          state.device.id !== deviceId &&
          now - lastRecoveryTimeRef.current > 30000
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
        // Only log errors, not warnings or info
        if (error instanceof Error) {
          throw error
        }
      }

      lastPlaybackCheckRef.current = now
    }

    const intervalId = setInterval(checkPlaybackHealth, STALL_CHECK_INTERVAL)
    return () => clearInterval(intervalId)
  }, [deviceId, playbackInfo, isInitializing, recover])

  return { healthStatus, setHealthStatus }
} 