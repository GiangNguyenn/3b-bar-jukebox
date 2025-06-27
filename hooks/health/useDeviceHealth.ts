import { useState, useEffect, useRef } from 'react'
import { useConsoleLogsContext } from '../ConsoleLogsProvider'
import { validateDevice } from '@/services/deviceManagement'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types/spotify'

type DeviceHealthStatus =
  | 'healthy'
  | 'unresponsive'
  | 'disconnected'
  | 'unknown'

const DEVICE_CHECK_DEBOUNCE = 2000 // 2 seconds debounce for device checks
const DEVICE_MISMATCH_THRESHOLD = 3
const DEVICE_CHANGE_GRACE_PERIOD = 10000 // 10 seconds
const DEVICE_CHECK_INTERVAL = 5000 // 5 seconds for initial checks

export function useDeviceHealth(deviceId: string | null): DeviceHealthStatus {
  const [deviceStatus, setDeviceStatus] =
    useState<DeviceHealthStatus>('unknown')
  const { addLog } = useConsoleLogsContext()

  const deviceMismatchCountRef = useRef(0)
  const lastDeviceHealthCheckRef = useRef<number>(0)
  const deviceCheckInterval = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!deviceId) {
      setDeviceStatus('unknown')
      return
    }

    let interval: NodeJS.Timeout | null = null

    const timeout = setTimeout(() => {
      const checkDeviceHealth = async (): Promise<void> => {
        const intervalDeviceId = deviceId

        try {
          if (!intervalDeviceId) {
            addLog(
              'WARN',
              'No device ID available for health check',
              'DeviceHealth'
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
          await sendApiRequest<SpotifyPlaybackState>({
            path: 'me/player?market=from_token',
            method: 'GET'
          })

          // Use intelligent validation with context
          const validationResult = await validateDevice(intervalDeviceId)

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
                `Device health check failed: ${validationResult.errors.join(
                  ', '
                )}`,
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
          if (error instanceof Error) {
            addLog(
              'ERROR',
              `Error checking device health: ${error.message}`,
              'DeviceHealth',
              error
            )
          }
        }
      }

      void checkDeviceHealth()
      interval = setInterval(() => {
        void checkDeviceHealth()
      }, DEVICE_CHECK_INTERVAL)
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
    }
  }, [deviceId, addLog])

  return deviceStatus
}
