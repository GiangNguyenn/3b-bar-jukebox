import { ApiError, sendApiRequest } from '@/shared/api'
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
export function setDeviceTransferLogger(logger: typeof addLog): void {
  addLog = logger
}

/**
 * Transfer playback to a specific device
 * @param deviceId - The device ID to transfer playback to
 * @param maxAttempts - Maximum number of transfer attempts (default: 3)
 * @param delayBetweenAttempts - Delay between retry attempts in ms (default: 1000)
 * @param skipVerificationOnNetworkError - If true, skip device state verification on network errors (default: true)
 * @param shouldPlay - Start playback on the device (true), pause it (false), or keep the current state (null)
 * @param requireListed - If true (default), give up at once when Spotify's
 *   device list does not include the device. A freshly created SDK player
 *   can take several seconds to appear in that list while Spotify already
 *   accepts a transfer to it, so player setup passes false and lets the
 *   transfer request itself say whether the device exists.
 */
export async function transferPlaybackToDevice(
  deviceId: string,
  maxAttempts: number = 3,
  delayBetweenAttempts: number = 1000,
  skipVerificationOnNetworkError: boolean = true,
  shouldPlay: boolean | null = null, // Default to null (maintain current state)
  requireListed: boolean = true
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
      // Validate device first - early exit if device is gone
      const validation = requireListed
        ? await validateDevice(deviceId)
        : { isValid: true, errors: [] }

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
          body,
          // Spotify answers 404 while a new device is still registering
          ...(!requireListed && { expectedErrorStatuses: [404] })
        })

        if (addLog) {
          addLog(
            'INFO',
            `Device transfer API call succeeded for device: ${deviceId}`,
            'DeviceTransfer'
          )
        }
      } catch (transferError) {
        // If transfer API call itself fails, retry the whole loop
        const isNetworkErr = isNetworkError(transferError)
        // Expected while a new device is still registering with Spotify
        const notRegisteredYet =
          !requireListed &&
          transferError instanceof ApiError &&
          transferError.status === 404
        if (addLog) {
          addLog(
            isNetworkErr || notRegisteredYet ? 'WARN' : 'ERROR',
            `Device transfer API call failed: ${isNetworkErr ? 'network error' : notRegisteredYet ? 'Spotify does not know the device yet (404)' : 'API error'}`,
            'DeviceTransfer',
            transferError instanceof Error ? transferError : undefined
          )
        }
        attempts++
        if (attempts < maxAttempts) {
          const backoffDelay = delayBetweenAttempts * attempts
          await new Promise((resolve) => setTimeout(resolve, backoffDelay))
          continue // Retry the main loop
        }
        return false // Exhausted retries on transfer API
      }

      // Transfer API succeeded. Now verify.
      // We decouple this from the main retry loop to avoid spamming the Transfer API
      // if the API call worked but verification is just lagging.

      let verificationSucceeded = false
      let verificationError: unknown = null

      // Extended polling: 10 attempts * 500ms = 5 seconds
      // This handles slow propagation of device state
      const verificationAttempts = 10
      const verificationInterval = 500

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
            method: 'GET',
            // Each poll must see fresh state, not the cached pre-transfer one
            debounceTime: 0
          })

          if (!state?.device) {
            verificationError = new Error('No device in playback state')
            // Continue polling
          } else if (state.device.id !== deviceId) {
            verificationError = new Error(
              `Device ID mismatch: expected ${deviceId}, got ${state.device.id} (${state.device.name})`
            )
            // Continue polling
          } else {
            verificationSucceeded = true
            break // Success!
          }
        } catch (verifyError) {
          verificationError = verifyError

          // on network error during verification, we might want to just trust the transfer
          if (isNetworkError(verifyError) && skipVerificationOnNetworkError) {
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

      if (verificationSucceeded) {
        return true
      }

      // Verification failed after all polling attempts
      if (addLog) {
        addLog(
          'WARN',
          `Device verification failed after transfer: ${verificationError instanceof Error ? verificationError.message : String(verificationError)}`,
          'DeviceTransfer'
        )
      }

      // If we are here, Transfer API said 204 OK, but State API says "Not Active".
      // We can try to retry the Transfer command ONE more time if we haven't exhausted maxAttempts.
      // But we shouldn't spam it.
      attempts++
      if (attempts < maxAttempts) {
        const backoffDelay = delayBetweenAttempts * attempts
        if (addLog) {
          addLog(
            'WARN',
            `Retrying device transfer (attempt ${attempts + 1}/${maxAttempts}) after verification timeout`,
            'DeviceTransfer'
          )
        }
        await new Promise((resolve) => setTimeout(resolve, backoffDelay))
        continue
      }

      return false
    } catch (error) {
      // Catch-all for unexpected errors in the outer loop
      const isNetworkErr = isNetworkError(error)
      if (addLog) {
        addLog(
          isNetworkErr ? 'WARN' : 'ERROR',
          `Transfer process failed: ${isNetworkErr ? 'network error' : 'unexpected error'}`,
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
