import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'
import { DeviceVerificationState } from '@/shared/types/recovery'
import { VERIFICATION_TIMEOUT } from '@/shared/constants/recovery'

// Add logging context
let addLog: (level: 'LOG' | 'INFO' | 'WARN' | 'ERROR', message: string, context?: string, error?: Error) => void

// Function to set the logging function
export function setDeviceManagementLogger(logger: typeof addLog) {
  addLog = logger
}

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
    if (addLog) {
      addLog('ERROR', 'No device ID provided for verification', 'DeviceManagement')
    } else {
      console.error('[Device Management] No device ID provided for verification')
    }
    return false
  }

  let retries = 0
  const maxRetries = 3
  const retryDelay = 1000 // 1 second

  while (retries < maxRetries) {
    try {
      // Get all available devices first
      const devicesResponse = await sendApiRequest<{
        devices: Array<{
          id: string
          is_active: boolean
          is_restricted: boolean
          type: string
          name: string
        }>
      }>({
        path: 'me/player/devices',
        method: 'GET'
      })

      if (!devicesResponse?.devices) {
        console.error('[Device Management] Failed to get devices list')
        retries++
        await new Promise((resolve) => setTimeout(resolve, retryDelay))
        continue
      }

      // Find our target device
      const targetDevice = devicesResponse.devices.find(
        (d) => d.id === deviceId
      )

      // If target device not found, try to find a Jukebox device
      if (!targetDevice) {
        const jukeboxDevice = devicesResponse.devices.find(
          (d) => d.name.startsWith('Jukebox-')
        )
        if (jukeboxDevice) {
          console.log('[Device Management] Found Jukebox device:', {
            oldDeviceId: deviceId,
            newDeviceId: jukeboxDevice.id,
            name: jukeboxDevice.name
          })
          // Update the device ID in the player state
          if (typeof window.spotifyPlayerInstance?.connect === 'function') {
            await window.spotifyPlayerInstance.connect()
          }
          return true
        }
      }

      if (!targetDevice) {
        console.error('[Device Management] Target device not found:', {
          deviceId,
          availableDevices: devicesResponse.devices.map((d) => ({
            id: d.id,
            name: d.name
          }))
        })
        retries++
        await new Promise((resolve) => setTimeout(resolve, retryDelay))
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
        await new Promise((resolve) => setTimeout(resolve, retryDelay))
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
        await new Promise((resolve) => setTimeout(resolve, retryDelay))
        continue
      }

      if (state.device.id !== deviceId) {
        console.error('[Device Management] Device ID mismatch:', {
          expected: deviceId,
          actual: state.device.id
        })
        retries++
        await new Promise((resolve) => setTimeout(resolve, retryDelay))
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
      if (
        !deviceReady.isActive ||
        deviceReady.isRestricted ||
        !deviceReady.volumeSupported
      ) {
        console.error('[Device Management] Device not ready for playback:', {
          deviceId,
          deviceReady
        })
        retries++
        await new Promise((resolve) => setTimeout(resolve, retryDelay))
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
        await new Promise((resolve) => setTimeout(resolve, retryDelay))
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
    console.error('[Device Management] Device existence check failed:', error)
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
  if (!deviceId) {
    console.error('[Device Transfer] No device ID provided')
    return false
  }

  let attempts = 0
  while (attempts < maxAttempts) {
    try {
      // Check if device exists
      const exists = await checkDeviceExists(deviceId)
      if (!exists) {
        console.error('[Device Transfer] Device does not exist:', deviceId)
        return false
      }

      // Transfer playback
      await sendApiRequest({
        path: 'me/player',
        method: 'PUT',
        body: JSON.stringify({
          device_ids: [deviceId],
          play: false
        })
      })

      // Wait for transfer to complete
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Verify transfer
      const state = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET'
      })

      if (!state?.device) {
        console.error('[Device Transfer] No device in playback state')
        attempts++
        if (attempts < maxAttempts) {
          await new Promise((resolve) =>
            setTimeout(resolve, delayBetweenAttempts)
          )
        }
        continue
      }

      if (state.device.id !== deviceId) {
        console.error('[Device Transfer] Target device not found in available devices')
        attempts++
        if (attempts < maxAttempts) {
          await new Promise((resolve) =>
            setTimeout(resolve, delayBetweenAttempts)
          )
        }
        continue
      }

      console.log('[Device Transfer] Playback transferred successfully:', {
        deviceId,
        deviceName: state.device.name
      })

      return true
    } catch (error) {
      console.error('[Device Transfer] Transfer failed:', error)
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
 * Cleans up other devices by transferring playback to the target device
 */
export async function cleanupOtherDevices(
  targetDeviceId: string
): Promise<boolean> {
  try {
    // Get all available devices
    const response = await sendApiRequest<{
      devices: Array<{
        id: string
        is_active: boolean
        name: string
      }>
    }>({
      path: 'me/player/devices',
      method: 'GET'
    })

    if (!response?.devices) {
      console.error('[Device Cleanup] No devices found')
      return false
    }

    // Find other active devices
    const otherDevices = response.devices.filter(
      (device) => device.id !== targetDeviceId && device.is_active
    )

    if (otherDevices.length > 0) {
      console.log('[Device Cleanup] Found other devices:', {
        otherDevices
      })

      // Transfer playback to target device
      const transferSuccessful = await transferPlaybackToDevice(targetDeviceId)
      if (!transferSuccessful) {
        console.error('[Device Cleanup] Failed to transfer playback to target device')
        return false
      }
    }

    return true
  } catch (error) {
    console.error('[Device Cleanup] Cleanup failed:', error)
    return false
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

  if (!deviceId) {
    errors.push('No device ID provided')
  }

  if (!state) {
    errors.push('No playback state available')
    return { isValid: false, errors }
  }

  if (!state.device) {
    errors.push('No device information in playback state')
    return { isValid: false, errors }
  }

  if (state.device.id !== deviceId) {
    errors.push('Device ID mismatch')
  }

  if (!state.device.is_active) {
    errors.push('Device is not active')
  }

  if (state.device.is_restricted) {
    errors.push('Device is restricted')
  }

  if (typeof state.device.volume_percent !== 'number') {
    errors.push('Device does not support volume control')
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

    const { isValid, errors } = validateDeviceState(deviceId, state)

    return {
      isHealthy: isValid,
      errors
    }
  } catch (error) {
    console.error('[Device Health] Health check failed:', error)
    return {
      isHealthy: false,
      errors: ['Failed to get device state']
    }
  }
}

/**
 * Ensures a device is healthy and ready for playback
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

  let attempts = 0
  const errors: string[] = []

  while (attempts < maxAttempts) {
    try {
      const state = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET'
      })

      if (!state?.device) {
        errors.push('No device information available')
        attempts++
        if (attempts < maxAttempts) {
          await new Promise((resolve) =>
            setTimeout(resolve, delayBetweenAttempts)
          )
        }
        continue
      }

      const { isValid, errors: validationErrors } = validateDeviceState(
        deviceId,
        state
      )

      if (!isValid) {
        errors.push(...validationErrors)
        attempts++
        if (attempts < maxAttempts) {
          await new Promise((resolve) =>
            setTimeout(resolve, delayBetweenAttempts)
          )
        }
        continue
      }

      const isActive = state.device.is_active
      if (requireActive && !isActive) {
        errors.push('Device is not active')
        attempts++
        if (attempts < maxAttempts) {
          await new Promise((resolve) =>
            setTimeout(resolve, delayBetweenAttempts)
          )
        }
        continue
      }

      return {
        isHealthy: true,
        isActive,
        errors: [],
        details: {
          deviceId: state.device.id,
          isActive: state.device.is_active,
          volume: state.device.volume_percent,
          timestamp: Date.now()
        }
      }
    } catch (error) {
      console.error('[Device Health] Health check failed:', error)
      errors.push('Failed to get device state')
      attempts++
      if (attempts < maxAttempts) {
        await new Promise((resolve) =>
          setTimeout(resolve, delayBetweenAttempts)
        )
      }
    }
  }

  return {
    isHealthy: false,
    isActive: false,
    errors,
    details: {
      deviceId: null,
      isActive: false,
      volume: null,
      timestamp: Date.now()
    }
  }
}
