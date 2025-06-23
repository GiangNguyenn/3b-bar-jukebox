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
      errors.push('Device not found in available devices')
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
