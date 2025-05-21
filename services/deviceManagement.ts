import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'
import { DeviceVerificationState } from '@/shared/types/recovery'
import { VERIFICATION_TIMEOUT } from '@/shared/constants/recovery'

// Device verification state management
const deviceVerificationState: DeviceVerificationState = {
  isVerifying: false,
  lastVerification: 0,
  verificationLock: false
}

// Lock management
function acquireVerificationLock(): boolean {
  if (deviceVerificationState.verificationLock) {
    return false
  }
  deviceVerificationState.verificationLock = true
  return true
}

function releaseVerificationLock(): void {
  deviceVerificationState.verificationLock = false
}

/**
 * Verifies if a device is active and ready for playback
 */
export async function verifyDeviceTransfer(deviceId: string): Promise<boolean> {
  if (!deviceId) {
    console.error('[Device Management] No device ID provided for verification')
    return false
  }

  let retries = 0
  const maxRetries = 3
  const retryDelay = 1000 // 1 second

  while (retries < maxRetries) {
    try {
      // Get all available devices first
      const devicesResponse = await sendApiRequest<{ devices: Array<{ id: string; is_active: boolean; is_restricted: boolean; type: string; name: string }> }>({
        path: 'me/player/devices',
        method: 'GET'
      })

      if (!devicesResponse?.devices) {
        console.error('[Device Management] Failed to get devices list')
        retries++
        await new Promise(resolve => setTimeout(resolve, retryDelay))
        continue
      }

      // Find our target device
      const targetDevice = devicesResponse.devices.find(d => d.id === deviceId)
      if (!targetDevice) {
        console.error('[Device Management] Target device not found:', {
          deviceId,
          availableDevices: devicesResponse.devices.map(d => ({ id: d.id, name: d.name }))
        })
        retries++
        await new Promise(resolve => setTimeout(resolve, retryDelay))
        continue
      }

      // Check device state
      const deviceState = {
        isActive: targetDevice.is_active,
        isRestricted: targetDevice.is_restricted,
        type: targetDevice.type,
        name: targetDevice.name
      }

      console.log('[Device Management] Device state:', {
        deviceId,
        ...deviceState,
        timestamp: new Date().toISOString()
      })

      // If device is restricted, it's not ready for playback
      if (deviceState.isRestricted) {
        console.error('[Device Management] Device is restricted:', {
          deviceId,
          deviceState
        })
        retries++
        await new Promise(resolve => setTimeout(resolve, retryDelay))
        continue
      }

      // Get current playback state
      const state = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET'
      })

      if (!state?.device) {
        console.error('[Device Management] No device in playback state')
        retries++
        await new Promise(resolve => setTimeout(resolve, retryDelay))
        continue
      }

      if (state.device.id !== deviceId) {
        console.error('[Device Management] Device ID mismatch:', {
          expected: deviceId,
          actual: state.device.id
        })
        retries++
        await new Promise(resolve => setTimeout(resolve, retryDelay))
        continue
      }

      // Verify device is ready for playback
      const deviceReady = {
        isActive: state.device.is_active,
        isRestricted: state.device.is_restricted,
        volumeSupported: typeof state.device.volume_percent === 'number',
        name: state.device.name
      }

      console.log('[Device Management] Device ready state:', {
        deviceId,
        ...deviceReady,
        timestamp: new Date().toISOString()
      })

      // Check if device is fully ready
      if (!deviceReady.isActive || deviceReady.isRestricted || !deviceReady.volumeSupported) {
        console.error('[Device Management] Device not ready for playback:', {
          deviceId,
          deviceReady
        })
        retries++
        await new Promise(resolve => setTimeout(resolve, retryDelay))
        continue
      }

      console.log('[Device Management] Device verification successful:', {
        deviceId,
        deviceName: deviceReady.name,
        timestamp: new Date().toISOString()
      })

      return true
    } catch (error) {
      console.error('[Device Management] Verification error:', error)
      retries++
      if (retries < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay))
      }
    }
  }

  return false
}

/**
 * Checks if a device exists in the user's available devices
 */
export async function checkDeviceExists(deviceId: string): Promise<boolean> {
  try {
    const response = await sendApiRequest<{ devices: Array<{ id: string }> }>({
      path: 'me/player/devices',
      method: 'GET'
    })

    if (!response?.devices) {
      console.error('[Device Management] No devices found in response')
      return false
    }

    const deviceExists = response.devices.some(
      (device) => device.id === deviceId
    )
    console.log('[Device Management] Device existence check:', {
      deviceId,
      exists: deviceExists,
      availableDevices: response.devices.map((d) => d.id)
    })

    return deviceExists
  } catch (error) {
    console.error('[Device Management] Error checking device existence:', error)
    return false
  }
}

/**
 * Transfers playback to a specific device
 */
export async function transferPlaybackToDevice(
  deviceId: string,
  maxAttempts: number = 3,
  delayBetweenAttempts: number = 1000
): Promise<boolean> {
  // First check if device exists
  const deviceExists = await checkDeviceExists(deviceId)
  if (!deviceExists) {
    console.error('[Device Transfer] Device does not exist:', deviceId)
    return false
  }

  // Try to acquire lock
  const hasLock = acquireVerificationLock()
  if (!hasLock) {
    console.log('[Device Transfer] Could not acquire lock, skipping')
    return false
  }

  try {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // First check if device is already active
        const currentState = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET'
        })

        if (currentState?.device?.id === deviceId && currentState.device.is_active) {
          console.log('[Device Transfer] Device already active')
          return true
        }

        // Get device details before transfer
        const devicesResponse = await sendApiRequest<{ devices: Array<{ id: string; is_active: boolean; is_restricted: boolean; type: string; name: string }> }>({
          path: 'me/player/devices',
          method: 'GET'
        })

        const targetDevice = devicesResponse?.devices.find(d => d.id === deviceId)
        if (!targetDevice) {
          console.error('[Device Transfer] Target device not found in available devices')
          continue
        }

        if (targetDevice.is_restricted) {
          console.error('[Device Transfer] Device is restricted:', {
            deviceId,
            deviceName: targetDevice.name
          })
          continue
        }

        // Attempt transfer
        await sendApiRequest({
          path: 'me/player',
          method: 'PUT',
          body: {
            device_ids: [deviceId],
            play: false
          }
        })

        // Wait for transfer to take effect
        await new Promise(resolve => setTimeout(resolve, delayBetweenAttempts))

        // Verify transfer
        const isSuccessful = await verifyDeviceTransfer(deviceId)
        if (isSuccessful) {
          console.log('[Device Transfer] Transfer successful')
          return true
        }

        if (attempt < maxAttempts - 1) {
          console.log(`[Device Transfer] Attempt ${attempt + 1} failed, retrying...`)
          await new Promise(resolve => setTimeout(resolve, delayBetweenAttempts))
        }
      } catch (error) {
        console.error(`[Device Transfer] Attempt ${attempt + 1} failed:`, error)
        if (attempt < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, delayBetweenAttempts))
        }
      }
    }
    return false
  } finally {
    releaseVerificationLock()
  }
}

/**
 * Validates the current device state
 */
export function validateDeviceState(
  deviceId: string | null,
  state: SpotifyPlaybackState | null
): { isValid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!state) {
    errors.push('No playback state available')
    return { isValid: false, errors }
  }

  if (!state.device) {
    errors.push('No device information available')
    return { isValid: false, errors }
  }

  if (!deviceId) {
    errors.push('No target device ID provided')
    return { isValid: false, errors }
  }

  if (state.device.id !== deviceId) {
    errors.push('Device ID mismatch')
  }

  if (!state.device.is_active) {
    errors.push('Device is not active')
  }

  // Enhanced checks
  if (state.device.volume_percent === undefined) {
    errors.push('Device volume not set')
  }

  if (state.device.is_restricted) {
    errors.push('Device is restricted')
  }

  // Only allow certain device types (customize as needed)
  if (state.device.type !== 'Computer' && state.device.type !== 'Smartphone') {
    errors.push(`Device type not supported: ${state.device.type}`)
  }

  // If your API provides this property, check playback support
  if (
    typeof (state.device as any).supports_playback === 'boolean' &&
    !(state.device as any).supports_playback
  ) {
    errors.push('Device does not support playback')
  }

  return {
    isValid: errors.length === 0,
    errors
  }
}

/**
 * Checks the health of a device
 */
export async function checkDeviceHealth(deviceId: string): Promise<{
  isHealthy: boolean
  errors: string[]
}> {
  try {
    const state = await sendApiRequest<SpotifyPlaybackState>({
      path: 'me/player',
      method: 'GET'
    })

    const validation = validateDeviceState(deviceId, state)
    if (!validation.isValid) {
      return {
        isHealthy: false,
        errors: validation.errors
      }
    }

    return {
      isHealthy: true,
      errors: []
    }
  } catch (error) {
    console.error('[Device Health Check] Error:', error)
    return {
      isHealthy: false,
      errors: ['Failed to check device health']
    }
  }
}

/**
 * Comprehensive device health check that combines all device validation steps
 */
export async function ensureDeviceHealth(
  deviceId: string,
  options: {
    maxAttempts?: number
    delayBetweenAttempts?: number
    requireActive?: boolean
  } = {}
): Promise<{
  isHealthy: boolean
  isActive: boolean
  errors: string[]
  details: {
    deviceId: string | null
    isActive: boolean
    volume: number | null
    timestamp: number
  }
}> {
  const {
    maxAttempts = 3,
    delayBetweenAttempts = 1000,
    requireActive = true
  } = options

  try {
    // First do a quick health check
    const healthCheck = await checkDeviceHealth(deviceId)
    if (!healthCheck.isHealthy) {
      return {
        isHealthy: false,
        isActive: false,
        errors: healthCheck.errors,
        details: {
          deviceId: null,
          isActive: false,
          volume: null,
          timestamp: Date.now()
        }
      }
    }

    // Get current state for details
    const state = await sendApiRequest<SpotifyPlaybackState>({
      path: 'me/player',
      method: 'GET'
    })

    const details = {
      deviceId: state?.device?.id ?? null,
      isActive: state?.device?.is_active ?? false,
      volume: state?.device?.volume_percent ?? null,
      timestamp: Date.now()
    }

    // If we don't require active state, return early
    if (!requireActive) {
      return {
        isHealthy: true,
        isActive: details.isActive,
        errors: [],
        details
      }
    }

    // Verify device is ready for playback
    const isActive = await verifyDeviceTransfer(deviceId)
    if (!isActive) {
      return {
        isHealthy: false,
        isActive: false,
        errors: ['Device is not active or ready for playback'],
        details
      }
    }

    return {
      isHealthy: true,
      isActive: true,
      errors: [],
      details
    }
  } catch (error) {
    console.error('[Device Health] Error checking device:', error)
    return {
      isHealthy: false,
      isActive: false,
      errors: ['Failed to check device health'],
      details: {
        deviceId: null,
        isActive: false,
        volume: null,
        timestamp: Date.now()
      }
    }
  }
}
