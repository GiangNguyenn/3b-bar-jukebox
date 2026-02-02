import { getAvailableDevices, getPlaybackState, findDevice } from './deviceApi'
import { createModuleLogger } from '@/shared/utils/logger'

// Set up logger for this module
const logger = createModuleLogger('DeviceValidation')

// Function to set the logging function (for compatibility with existing pattern)
export function setDeviceValidationLogger(loggerFn: typeof logger) {
  // This function is kept for compatibility but the logger is already set up
}

interface DeviceValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
  device?: {
    id: string
    name: string
    isActive: boolean
    isRestricted: boolean
  }
}

/**
 * Simplified device validation that consolidates all validation logic
 * Returns errors (blocking issues) and warnings (non-blocking issues)
 */
export async function validateDevice(
  deviceId: string
): Promise<DeviceValidationResult> {
  const errors: string[] = []
  const warnings: string[] = []

  if (!deviceId) {
    errors.push('No device ID provided')
    return { isValid: false, errors, warnings }
  }

  try {
    // Find target device by exact ID
    const targetDevice = await findDevice(deviceId)

    if (!targetDevice) {
      // Fallback: Check if the device is actually active via playback state
      // This handles cases where "me/player/devices" is stale or incomplete
      // but the device is actually playing music
      const playbackState = await getPlaybackState()

      if (
        playbackState?.device?.id === deviceId &&
        playbackState.device.is_active
      ) {
        // Device is active and playing, so it's valid despite not being in the list
        return {
          isValid: true,
          errors: [],
          warnings: [], // No warnings, as it's working
          device: {
            id: playbackState.device.id,
            name: playbackState.device.name,
            isActive: true,
            isRestricted: false // Assume safe if played by us
          }
        }
      }

      errors.push('Device not found in available devices')

      // STRICT JUKEBOX LOGIC:
      // If we are looking for a specific device ID (which we are, the one we just created),
      // and it's not in the list, it might just be hidden/inactive in the API but locally "Ready".
      // We should be careful about failing validation too aggressively here.
      // However, if we can't see it, we can't transfer to it usually.
      // But let's add a log warning instead of a hard error if it matches our expected ID
      // to allow "blind transfers" which sometimes work.
      // For now, we'll keep it as an error but ensure the caller handles "Device not found"
      // by triggering the new self-healing logic.
      return { isValid: false, errors, warnings }
    }

    // Check restrictions (critical error)
    if (targetDevice.is_restricted) {
      errors.push('Device is restricted')
    }

    // Check if active (warning, not error)
    if (!targetDevice.is_active) {
      warnings.push('Device is not active')
    }

    // Check playback state if device is active
    if (targetDevice.is_active) {
      const playbackState = await getPlaybackState()
      if (playbackState?.device?.id !== targetDevice.id) {
        warnings.push('Device ID mismatch in playback state')
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      device: {
        id: targetDevice.id,
        name: targetDevice.name,
        isActive: targetDevice.is_active,
        isRestricted: targetDevice.is_restricted
      }
    }
  } catch (error) {
    logger(
      'ERROR',
      'Device validation error',
      undefined,
      error instanceof Error ? error : undefined
    )

    errors.push('Failed to validate device')
    return { isValid: false, errors, warnings }
  }
}
