import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types/spotify'

// Add logging context
let addLog: (
  level: 'LOG' | 'INFO' | 'WARN' | 'ERROR',
  message: string,
  context?: string,
  error?: Error
) => void

// Function to set the logging function
export function setDeviceApiLogger(logger: typeof addLog) {
  addLog = logger
}

interface SpotifyDevice {
  id: string
  is_active: boolean
  is_restricted: boolean
  type: string
  name: string
}

interface DevicesResponse {
  devices: SpotifyDevice[]
}

/**
 * Get all available devices from Spotify API
 */
export async function getAvailableDevices(): Promise<SpotifyDevice[]> {
  try {
    const response = await sendApiRequest<DevicesResponse>({
      path: 'me/player/devices',
      method: 'GET'
    })

    if (!response?.devices) {
      if (addLog) {
        addLog('ERROR', 'Failed to get devices list', 'DeviceApi')
      } else {
        console.error('[Device API] Failed to get devices list')
      }
      return []
    }

    return response.devices
  } catch (error) {
    if (addLog) {
      addLog(
        'ERROR',
        'Error getting available devices',
        'DeviceApi',
        error instanceof Error ? error : undefined
      )
    } else {
      console.error('[Device API] Error getting available devices:', error)
    }
    return []
  }
}

/**
 * Get current playback state from Spotify API
 */
export async function getPlaybackState(): Promise<SpotifyPlaybackState | null> {
  try {
    const state = await sendApiRequest<SpotifyPlaybackState>({
      path: 'me/player',
      method: 'GET'
    })

    return state
  } catch (error) {
    if (addLog) {
      addLog(
        'ERROR',
        'Error getting playback state',
        'DeviceApi',
        error instanceof Error ? error : undefined
      )
    } else {
      console.error('[Device API] Error getting playback state:', error)
    }
    return null
  }
}

/**
 * Find a device by exact ID
 * @param deviceId - The exact device ID to find
 * @returns The found device or null
 */
export async function findDevice(
  deviceId: string
): Promise<SpotifyDevice | null> {
  const devices = await getAvailableDevices()
  return devices.find((device) => device.id === deviceId) || null
}
