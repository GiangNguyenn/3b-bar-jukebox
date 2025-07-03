import { sendApiRequest } from '@/shared/api'
import { validateDevice } from './deviceValidation'
import { getAvailableDevices } from './deviceApi'

// Add logging context
let addLog: (
  level: 'LOG' | 'INFO' | 'WARN' | 'ERROR',
  message: string,
  context?: string,
  error?: Error
) => void

// Function to set the logging function
export function setDeviceTransferLogger(logger: typeof addLog) {
  addLog = logger
}

/**
 * Transfer playback to a specific device
 */
export async function transferPlaybackToDevice(
  deviceId: string,
  maxAttempts: number = 3,
  delayBetweenAttempts: number = 1000
): Promise<boolean> {
  if (!deviceId) {
    if (addLog) {
      addLog('ERROR', 'No device ID provided for transfer', 'DeviceTransfer')
    } else {
      console.error('[Device Transfer] No device ID provided')
    }
    return false
  }

  let attempts = 0
  while (attempts < maxAttempts) {
    try {
      // Validate device first
      const validation = await validateDevice(deviceId)

      if (!validation.isValid) {
        if (addLog) {
          addLog(
            'ERROR',
            `Device validation failed: ${validation.errors.join(', ')}`,
            'DeviceTransfer'
          )
        } else {
          console.error(
            '[Device Transfer] Device validation failed:',
            validation.errors
          )
        }
        return false
      }

      // Transfer playback
      await sendApiRequest({
        path: 'me/player',
        method: 'PUT',
        body: {
          device_ids: [deviceId],
          play: false
        }
      })

      // Wait for transfer to complete
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Verify transfer by checking playback state
      const state = await sendApiRequest<{
        device: { id: string; name: string }
      }>({
        path: 'me/player?market=from_token',
        method: 'GET'
      })

      if (!state?.device) {
        if (addLog) {
          addLog(
            'WARN',
            'No device in playback state after transfer',
            'DeviceTransfer'
          )
        } else {
          console.warn(
            '[Device Transfer] No device in playback state after transfer'
          )
        }
        attempts++
        if (attempts < maxAttempts) {
          await new Promise((resolve) =>
            setTimeout(resolve, delayBetweenAttempts)
          )
        }
        continue
      }

      if (state.device.id !== deviceId) {
        if (addLog) {
          addLog(
            'WARN',
            `Device ID mismatch after transfer: expected ${deviceId}, got ${state.device.id}`,
            'DeviceTransfer'
          )
        } else {
          console.warn('[Device Transfer] Device ID mismatch after transfer:', {
            expected: deviceId,
            actual: state.device.id
          })
        }
        attempts++
        if (attempts < maxAttempts) {
          await new Promise((resolve) =>
            setTimeout(resolve, delayBetweenAttempts)
          )
        }
        continue
      }

      if (addLog) {
        addLog(
          'INFO',
          `Playback transferred successfully to ${state.device.name}`,
          'DeviceTransfer'
        )
      } else {
        console.log('[Device Transfer] Playback transferred successfully:', {
          deviceId,
          deviceName: state.device.name
        })
      }

      return true
    } catch (error) {
      if (addLog) {
        addLog(
          'ERROR',
          'Transfer failed',
          'DeviceTransfer',
          error instanceof Error ? error : undefined
        )
      } else {
        console.error('[Device Transfer] Transfer failed:', error)
      }
      attempts++
      if (attempts < maxAttempts) {
        await new Promise((resolve) =>
          setTimeout(resolve, delayBetweenAttempts)
        )
      }
    }
  }

  return false
}

/**
 * Clean up other devices by transferring playback to the target device
 */
export async function cleanupOtherDevices(
  targetDeviceId: string
): Promise<boolean> {
  try {
    // Get all available devices
    const devices = await getAvailableDevices()

    if (devices.length === 0) {
      if (addLog) {
        addLog('ERROR', 'No devices found for cleanup', 'DeviceTransfer')
      } else {
        console.error('[Device Transfer] No devices found for cleanup')
      }
      return false
    }

    // Find other active devices
    const otherDevices = devices.filter(
      (device) => device.id !== targetDeviceId && device.is_active
    )

    if (otherDevices.length > 0) {
      if (addLog) {
        addLog(
          'INFO',
          `Found ${otherDevices.length} other active devices to clean up`,
          'DeviceTransfer'
        )
      } else {
        console.log('[Device Transfer] Found other active devices:', {
          otherDevices: otherDevices.map((d) => ({ id: d.id, name: d.name }))
        })
      }

      // Transfer playback to target device
      const transferSuccessful = await transferPlaybackToDevice(targetDeviceId)
      if (!transferSuccessful) {
        if (addLog) {
          addLog(
            'ERROR',
            'Failed to transfer playback to target device',
            'DeviceTransfer'
          )
        } else {
          console.error(
            '[Device Transfer] Failed to transfer playback to target device'
          )
        }
        return false
      }
    }

    return true
  } catch (error) {
    if (addLog) {
      addLog(
        'ERROR',
        'Device cleanup failed',
        'DeviceTransfer',
        error instanceof Error ? error : undefined
      )
    } else {
      console.error('[Device Transfer] Device cleanup failed:', error)
    }
    return false
  }
}
