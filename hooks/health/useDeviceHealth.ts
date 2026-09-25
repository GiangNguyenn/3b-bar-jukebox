import { useState, useRef, useEffect } from 'react'
import { useConsoleLogsContext } from '../ConsoleLogsProvider'
import {
  validateDevice,
  DEVICE_NOT_FOUND_ERROR
} from '@/services/deviceManagement'
import { playerLifecycleService } from '@/services/playerLifecycle'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { useHealthInterval } from './utils/useHealthInterval'
import { handleHealthError } from './utils/errorHandling'
import {
  attemptDeviceRecovery,
  shouldAttemptDeviceRecovery
} from '@/recovery/deviceRecovery'
import { recoveryManager } from '@/services/player/recoveryManager'
import { spotifyPlayerStore } from '@/hooks/spotifyPlayerStore'

type DeviceHealthStatus =
  | 'healthy'
  | 'unresponsive'
  | 'disconnected'
  | 'unknown'

const DEVICE_CHECK_DEBOUNCE = 2000 // 2 seconds debounce for device checks
const DEVICE_MISMATCH_THRESHOLD = 3
const DEVICE_CHANGE_GRACE_PERIOD = 2000 // 2 seconds
const DEVICE_CHECK_INTERVAL = 60000 // 60 seconds - reduced frequency to lower API usage
// When Spotify stops listing our device, confirm quickly rather than waiting
// for DEVICE_MISMATCH_THRESHOLD regular checks (3 minutes of silence).
const DEVICE_NOT_FOUND_RECHECK_MS = 15000
const RECONNECT_SETTLE_MS = 2000

export function useDeviceHealth(deviceId: string | null): DeviceHealthStatus {
  const [deviceStatus, setDeviceStatus] =
    useState<DeviceHealthStatus>('unknown')
  const { addLog } = useConsoleLogsContext()

  const deviceMismatchCountRef = useRef(0)
  const lastDeviceHealthCheckRef = useRef<number>(0)
  const lastRecoveryAttemptRef = useRef<number>(0)
  const consecutiveRecoveryFailuresRef = useRef<number>(0)
  const isRecoveringRef = useRef<boolean>(false)
  const deviceNotFoundCountRef = useRef(0)
  const recheckTimerRef = useRef<NodeJS.Timeout | null>(null)

  const checkDeviceHealth = async (): Promise<void> => {
    if (recoveryManager.isTokenSuspended()) return

    if (!deviceId) {
      setDeviceStatus('unknown')
      return
    }

    try {
      // Debounce device health checks to prevent rapid error accumulation
      const now = Date.now()
      const timeSinceLastCheck = now - lastDeviceHealthCheckRef.current
      if (timeSinceLastCheck < DEVICE_CHECK_DEBOUNCE) {
        return
      }
      lastDeviceHealthCheckRef.current = now

      // Get current playback state for intelligent validation
      await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player?market=from_token',
        method: 'GET'
      })

      // Use intelligent validation with context
      const validationResult = await validateDevice(deviceId)

      // Check for "Device is not active" warning and attempt recovery
      const hasInactiveDeviceWarning = validationResult.warnings.some(
        (warning) => warning === 'Device is not active'
      )

      // Log warnings but don't count them as errors
      if (validationResult.warnings.length > 0) {
        addLog(
          'WARN',
          `Device warnings: ${validationResult.warnings.join(', ')}`,
          'DeviceHealth'
        )
      }

      // Attempt automatic recovery for inactive device (if not already recovering)
      if (
        hasInactiveDeviceWarning &&
        !isRecoveringRef.current &&
        shouldAttemptDeviceRecovery(
          lastRecoveryAttemptRef.current,
          consecutiveRecoveryFailuresRef.current
        )
      ) {
        isRecoveringRef.current = true
        lastRecoveryAttemptRef.current = Date.now()

        // Attempt recovery asynchronously (don't block health check)
        void (async () => {
          try {
            // Read the Web Playback SDK's last known local state - it's
            // updated independently of the failing Web API calls, so it
            // tells us whether we were mid-track when the device dropped
            // (a real disruption) versus never having been playing here.
            const wasPlayingLocally =
              spotifyPlayerStore.getState().playbackState?.is_playing === true

            const recoveryResult = await attemptDeviceRecovery(
              deviceId,
              consecutiveRecoveryFailuresRef.current,
              addLog,
              wasPlayingLocally
            )

            consecutiveRecoveryFailuresRef.current =
              recoveryResult.consecutiveFailures

            if (recoveryResult.success) {
              // Recovery succeeded - device should now be active
              // Next health check will confirm
            } else if (!recoveryResult.skipped) {
              // Recovery failed (not skipped) - log for visibility
              if (recoveryResult.error) {
                addLog(
                  'WARN',
                  `Device recovery failed: ${recoveryResult.reason || recoveryResult.error.message}`,
                  'DeviceHealth',
                  recoveryResult.error
                )
              }
            }
            // If skipped (e.g., music playing elsewhere), no action needed
          } catch (error) {
            addLog(
              'ERROR',
              'Unexpected error during device recovery',
              'DeviceHealth',
              error instanceof Error ? error : undefined
            )
          } finally {
            isRecoveringRef.current = false
          }
        })()
      }

      // Spotify answered and our device isn't in its list: the SDK player
      // has lost its registration. Nothing can reach it until it's recreated.
      if (validationResult.errors.includes(DEVICE_NOT_FOUND_ERROR)) {
        deviceNotFoundCountRef.current += 1
        if (deviceNotFoundCountRef.current >= 2) {
          deviceNotFoundCountRef.current = 0
          playerLifecycleService.reportDeviceLost('device health check')
        } else {
          addLog(
            'WARN',
            `Spotify does not list this player as a device — re-checking in ${DEVICE_NOT_FOUND_RECHECK_MS / 1000}s`,
            'DeviceHealth'
          )
          if (recheckTimerRef.current) clearTimeout(recheckTimerRef.current)
          recheckTimerRef.current = setTimeout(() => {
            recheckTimerRef.current = null
            lastDeviceHealthCheckRef.current = 0
            void checkDeviceHealthRef.current()
          }, DEVICE_NOT_FOUND_RECHECK_MS)
        }
      } else {
        deviceNotFoundCountRef.current = 0
      }

      if (!validationResult.isValid) {
        deviceMismatchCountRef.current += 1
        if (deviceMismatchCountRef.current >= DEVICE_MISMATCH_THRESHOLD) {
          addLog(
            'ERROR',
            `Device health check failed: ${validationResult.errors.join(', ')}`,
            'DeviceHealth'
          )
          const hasDeviceMismatch = validationResult.errors.some((error) =>
            error.includes('Device ID mismatch')
          )
          if (hasDeviceMismatch) {
            setDeviceStatus('unresponsive')
            addLog(
              'WARN',
              'Another device is currently active - press play to transfer playback to jukebox',
              'DeviceHealth'
            )
          } else {
            setDeviceStatus('disconnected')
          }
          deviceMismatchCountRef.current = 0
        }
      } else {
        deviceMismatchCountRef.current = 0
        // Device is working properly, set status to healthy
        setDeviceStatus('healthy')
      }
    } catch (error) {
      handleHealthError(
        error,
        addLog,
        'DeviceHealth',
        'Error checking device health'
      )
    }
  }

  const checkDeviceHealthRef = useRef(checkDeviceHealth)
  checkDeviceHealthRef.current = checkDeviceHealth

  useHealthInterval(checkDeviceHealth, {
    interval: DEVICE_CHECK_INTERVAL,
    enabled: deviceId !== null,
    initialDelay: DEVICE_CHANGE_GRACE_PERIOD
  })

  // A network drop or the laptop sleeping are the usual ways the SDK player
  // loses its Spotify registration. The browser tells us when either ends,
  // so check straight away rather than waiting for the next scheduled check.
  useEffect(() => {
    if (!deviceId) return

    let settleTimer: NodeJS.Timeout | null = null
    const checkSoon = (reason: string): void => {
      if (settleTimer) clearTimeout(settleTimer)
      // Give the connection a moment to settle before asking Spotify
      settleTimer = setTimeout(() => {
        settleTimer = null
        void playerLifecycleService
          .verifyDeviceRegistered(reason)
          .catch(() => {})
      }, RECONNECT_SETTLE_MS)
    }
    const onOnline = (): void => checkSoon('network reconnected')
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        checkSoon('page became visible')
      }
    }

    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      if (settleTimer) clearTimeout(settleTimer)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [deviceId])

  // Reset status when deviceId changes
  useEffect(() => {
    deviceNotFoundCountRef.current = 0
    if (!deviceId) {
      setDeviceStatus('unknown')
    }
    return () => {
      if (recheckTimerRef.current) {
        clearTimeout(recheckTimerRef.current)
        recheckTimerRef.current = null
      }
    }
  }, [deviceId])

  return deviceStatus
}
