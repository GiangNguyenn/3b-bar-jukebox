import { getAvailableDevices, getPlaybackState, findDevice } from './deviceApi'

// Add logging context
let addLog: (
  level: 'LOG' | 'INFO' | 'WARN' | 'ERROR',
  message: string,
  context?: string,
  error?: Error
) => void

// Function to set the logging function
export function setDeviceValidationLogger(logger: typeof addLog) {
  addLog = logger
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

    // Log validation result
    if (addLog) {
      addLog(
        'INFO',
        `Device validation result: ${errors.length} errors, ${warnings.length} warnings`,
        'DeviceValidation'
      )
    } else {
      console.log('[Device Validation] Validation result:', {
        deviceId: targetDevice.id,
        deviceName: targetDevice.name,
        isValid: errors.length === 0,
        errors,
        warnings,
        timestamp: new Date().toISOString()
      })
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
    if (addLog) {
      addLog(
        'ERROR',
        'Device validation error',
        'DeviceValidation',
        error instanceof Error ? error : undefined
      )
    } else {
      console.error('[Device Validation] Validation error:', error)
    }

    errors.push('Failed to validate device')
    return { isValid: false, errors, warnings }
  }
}
