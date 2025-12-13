import { useState, useRef, useEffect } from 'react'
import { useConsoleLogsContext } from '../ConsoleLogsProvider'
import { validateDevice } from '@/services/deviceManagement'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { useHealthInterval } from './utils/useHealthInterval'
import { handleHealthError } from './utils/errorHandling'
import {
  attemptDeviceRecovery,
  shouldAttemptDeviceRecovery
} from '@/recovery/deviceRecovery'

type DeviceHealthStatus =
  | 'healthy'
  | 'unresponsive'
  | 'disconnected'
  | 'unknown'

const DEVICE_CHECK_DEBOUNCE = 2000 // 2 seconds debounce for device checks
const DEVICE_MISMATCH_THRESHOLD = 3
const DEVICE_CHANGE_GRACE_PERIOD = 2000 // 2 seconds
const DEVICE_CHECK_INTERVAL = 60000 // 60 seconds - reduced frequency to lower API usage

export function useDeviceHealth(deviceId: string | null): DeviceHealthStatus {
  const [deviceStatus, setDeviceStatus] =
    useState<DeviceHealthStatus>('unknown')
  const { addLog } = useConsoleLogsContext()

  const deviceMismatchCountRef = useRef(0)
  const lastDeviceHealthCheckRef = useRef<number>(0)
  const lastRecoveryAttemptRef = useRef<number>(0)
  const consecutiveRecoveryFailuresRef = useRef<number>(0)
  const isRecoveringRef = useRef<boolean>(false)

  const checkDeviceHealth = async (): Promise<void> => {
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
            const recoveryResult = await attemptDeviceRecovery(
              deviceId,
              consecutiveRecoveryFailuresRef.current,
              addLog
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

  useHealthInterval(checkDeviceHealth, {
    interval: DEVICE_CHECK_INTERVAL,
    enabled: deviceId !== null,
    initialDelay: DEVICE_CHANGE_GRACE_PERIOD
  })

  // Reset status when deviceId changes
  useEffect(() => {
    if (!deviceId) {
      setDeviceStatus('unknown')
    }
  }, [deviceId])

  return deviceStatus
}
