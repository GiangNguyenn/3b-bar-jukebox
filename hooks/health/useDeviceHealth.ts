import { useState, useRef, useEffect } from 'react'
import { useConsoleLogsContext } from '../ConsoleLogsProvider'
import { validateDevice } from '@/services/deviceManagement'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { useHealthInterval } from './utils/useHealthInterval'
import { handleHealthError } from './utils/errorHandling'

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

      // Log warnings but don't count them as errors
      if (validationResult.warnings.length > 0) {
        addLog(
          'WARN',
          `Device warnings: ${validationResult.warnings.join(', ')}`,
          'DeviceHealth'
        )
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
