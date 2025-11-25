import { sendApiRequest } from '@/shared/api'
import { validateDevice } from './deviceValidation'
import { getAvailableDevices } from './deviceApi'
import { isNetworkError } from '@/shared/utils/networkErrorDetection'

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
 * @param deviceId - The device ID to transfer playback to
 * @param maxAttempts - Maximum number of transfer attempts (default: 3)
 * @param delayBetweenAttempts - Delay between retry attempts in ms (default: 1000)
 * @param skipVerificationOnNetworkError - If true, skip device state verification on network errors (default: true)
 */
export async function transferPlaybackToDevice(
  deviceId: string,
  maxAttempts: number = 3,
  delayBetweenAttempts: number = 1000,
  skipVerificationOnNetworkError: boolean = true
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
  let transferApiSucceeded = false

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
      try {
        await sendApiRequest({
          path: 'me/player',
          method: 'PUT',
          body: {
            device_ids: [deviceId],
            play: false
          }
        })
        transferApiSucceeded = true

        if (addLog) {
          addLog(
            'INFO',
            `Device transfer API call succeeded for device: ${deviceId}`,
            'DeviceTransfer'
          )
        }
      } catch (transferError) {
        // If transfer API call itself fails, retry
        const isNetworkErr = isNetworkError(transferError)
        if (addLog) {
          addLog(
            isNetworkErr ? 'WARN' : 'ERROR',
            `Device transfer API call failed: ${isNetworkErr ? 'network error' : 'API error'}`,
            'DeviceTransfer',
            transferError instanceof Error ? transferError : undefined
          )
        }
        attempts++
        if (attempts < maxAttempts) {
          const backoffDelay = delayBetweenAttempts * attempts
          await new Promise((resolve) => setTimeout(resolve, backoffDelay))
        }
        continue
      }

      // Wait for transfer to complete
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Verify transfer by checking playback state (with retry and fallback)
      let verificationSucceeded = false
      let verificationError: unknown = null

      try {
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
              'No device in playback state after transfer - verification failed',
              'DeviceTransfer'
            )
          }
          verificationError = new Error('No device in playback state')
        } else if (state.device.id !== deviceId) {
          if (addLog) {
            addLog(
              'WARN',
              `Device ID mismatch after transfer: expected ${deviceId}, got ${state.device.id}`,
              'DeviceTransfer'
            )
          }
          verificationError = new Error(
            `Device ID mismatch: expected ${deviceId}, got ${state.device.id}`
          )
        } else {
          verificationSucceeded = true
        }
      } catch (verifyError) {
        verificationError = verifyError
        const isNetworkErr = isNetworkError(verifyError)

        if (addLog) {
          addLog(
            isNetworkErr ? 'WARN' : 'ERROR',
            `Device state verification failed: ${isNetworkErr ? 'network error (ERR_CONNECTION_CLOSED or similar)' : 'API error'}`,
            'DeviceTransfer',
            verifyError instanceof Error ? verifyError : undefined
          )
        }

        // If it's a network error and we're configured to skip verification, treat as success
        if (
          isNetworkErr &&
          skipVerificationOnNetworkError &&
          transferApiSucceeded
        ) {
          if (addLog) {
            addLog(
              'WARN',
              'Skipping device state verification due to network error - transfer API succeeded, assuming success',
              'DeviceTransfer'
            )
          }
          return true
        }
      }

      // If verification succeeded, we're done
      if (verificationSucceeded) {
        return true
      }

      // If verification failed but transfer API succeeded, and we're not skipping verification,
      // retry the entire process
      if (transferApiSucceeded && !skipVerificationOnNetworkError) {
        attempts++
        if (attempts < maxAttempts) {
          const backoffDelay = delayBetweenAttempts * attempts
          if (addLog) {
            addLog(
              'WARN',
              `Retrying device transfer (attempt ${attempts + 1}/${maxAttempts}) after verification failure`,
              'DeviceTransfer'
            )
          }
          await new Promise((resolve) => setTimeout(resolve, backoffDelay))
          continue
        }
      }

      // If we get here, verification failed and we've exhausted retries or can't skip
      if (addLog) {
        addLog(
          'ERROR',
          `Device transfer verification failed after ${attempts + 1} attempts`,
          'DeviceTransfer',
          verificationError instanceof Error ? verificationError : undefined
        )
      }
      return false
    } catch (error) {
      const isNetworkErr = isNetworkError(error)
      if (addLog) {
        addLog(
          isNetworkErr ? 'WARN' : 'ERROR',
          `Transfer failed: ${isNetworkErr ? 'network error' : 'unexpected error'}`,
          'DeviceTransfer',
          error instanceof Error ? error : undefined
        )
      } else {
        console.error('[Device Transfer] Transfer failed:', error)
      }
      attempts++
      if (attempts < maxAttempts) {
        const backoffDelay = delayBetweenAttempts * attempts
        await new Promise((resolve) => setTimeout(resolve, backoffDelay))
      }
    }
  }

  // If transfer API succeeded but verification failed and we can skip, return true
  if (transferApiSucceeded && skipVerificationOnNetworkError) {
    if (addLog) {
      addLog(
        'WARN',
        'Device transfer API succeeded but verification failed - returning success due to network error tolerance',
        'DeviceTransfer'
      )
    }
    return true
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
