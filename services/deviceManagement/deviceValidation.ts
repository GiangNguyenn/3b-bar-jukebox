import { getPlaybackState, listDevices } from './deviceApi'
import { createModuleLogger } from '@/shared/utils/logger'
import type {
  SpotifyDevice,
  SpotifyPlaybackState
} from '@/shared/types/spotify'

// Set up logger for this module
const logger = createModuleLogger('DeviceValidation')

// Function to set the logging function (for compatibility with existing pattern)
export function setDeviceValidationLogger(loggerFn: typeof logger): void {
  // This function is kept for compatibility but the logger is already set up
}

/**
 * Spotify answered, and its device list does not include this device: the
 * Web Playback SDK player has lost its registration and must be recreated.
 * (Distinct from 'Failed to validate device', which means we couldn't ask.)
 */
export const DEVICE_NOT_FOUND_ERROR = 'Device not found in available devices'

const shortId = (id: string | null | undefined): string =>
  id ? `${id.slice(0, 8)}…` : 'none'

/**
 * Says what Spotify does list when this player's device is missing: nothing
 * at all, or another device (a phone, another browser) that may have taken
 * over the account. The two call for different fixes. The wording is stable
 * for a given situation so that repeats collapse into one log row.
 */
export function describeMissingDevice(
  deviceId: string,
  devices: SpotifyDevice[],
  playbackState: SpotifyPlaybackState | null
): string {
  const listed =
    devices.length === 0
      ? 'Spotify lists no devices for this account'
      : `Spotify lists ${devices.length} other device${devices.length === 1 ? '' : 's'}: ${devices
          .map(
            (device) =>
              `"${device.name}" (${device.type}, ${device.is_active ? 'active' : 'inactive'}${device.is_restricted ? ', restricted' : ''}, ${shortId(device.id)})`
          )
          .join(', ')}`
  const playing = playbackState?.device
    ? `Spotify playback is ${playbackState.is_playing ? 'playing' : 'paused'} on "${playbackState.device.name}" (${shortId(playbackState.device.id)})`
    : 'Spotify reports no active playback'
  return `Player device ${shortId(deviceId)} is not registered with Spotify. ${listed}. ${playing}.`
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
    const devices = await listDevices()
    const targetDevice = devices.find((device) => device.id === deviceId)

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

      errors.push(DEVICE_NOT_FOUND_ERROR)
      logger('WARN', describeMissingDevice(deviceId, devices, playbackState))

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
