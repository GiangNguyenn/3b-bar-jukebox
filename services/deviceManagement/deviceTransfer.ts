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
  skipVerificationOnNetworkError: boolean = true,
  shouldPlay: boolean | null = false // Default to false (pause) to maintain legacy behavior
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
        const body: { device_ids: string[]; play?: boolean } = {
          device_ids: [deviceId]
        }

        // Only include play field if shouldPlay is not null
        // If null, we let Spotify maintain the current playback state
        if (shouldPlay !== null) {
          body.play = shouldPlay
        }

        await sendApiRequest({
          path: 'me/player',
          method: 'PUT',
          body
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

      // Verify transfer by checking playback state (with retry and fallback)
      // POLLING LOOP: Check multiple times to allow for API propagation delay
      let verificationSucceeded = false
      let verificationError: unknown = null

      const verificationAttempts = 4
      const verificationInterval = 500 // 500ms

      for (let vObj = 0; vObj < verificationAttempts; vObj++) {
        // Wait before checking
        await new Promise((resolve) =>
          setTimeout(resolve, verificationInterval)
        )

        try {
          const state = await sendApiRequest<{
            device: { id: string; name: string }
          }>({
            path: 'me/player?market=from_token',
            method: 'GET'
          })

          if (!state?.device) {
            verificationError = new Error('No device in playback state')
            // Continue polling
          } else if (state.device.id !== deviceId) {
            verificationError = new Error(
              `Device ID mismatch: expected ${deviceId}, got ${state.device.id}`
            )
            // Continue polling
          } else {
            verificationSucceeded = true
            break // Success!
          }
        } catch (verifyError) {
          verificationError = verifyError
          // If network error, might be transient, keep polling or accept success if transfer worked
          if (
            isNetworkError(verifyError) &&
            transferApiSucceeded &&
            skipVerificationOnNetworkError
          ) {
            if (addLog) {
              addLog(
                'WARN',
                'Network error during verification - treating transfer as success',
                'DeviceTransfer'
              )
            }
            return true
          }
        }
      }

      if (!verificationSucceeded) {
        if (addLog) {
          addLog(
            'WARN',
            `Device verification failed after transfer: ${verificationError instanceof Error ? verificationError.message : 'Unknown error'}`,
            'DeviceTransfer'
          )
        }
      } else {
        // Explicit return on success
        return true
      }

      // If we are here, verification failed after all attempts.
      // But if transfer API succeeded and we had a network error during verification loop,
      // we might want to trust it.
      // However, the loop logic above returns early on network error if configured.
      // So if we are here, either we didn't have a network error (just invalid state) or we don't skip on network error.

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
