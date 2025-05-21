import { useState, useCallback } from 'react'
import {
  checkDeviceExists,
  verifyDeviceTransfer,
  transferPlaybackToDevice
} from '@/services/deviceManagement'
import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'

interface DeviceState {
  isReady: boolean
  isTransferring: boolean
  error: string | null
}

export function useDeviceManager(deviceId: string | null) {
  const [state, setState] = useState<DeviceState>({
    isReady: false,
    isTransferring: false,
    error: null
  })

  const checkDevice = useCallback(async (): Promise<boolean> => {
    if (!deviceId) {
      setState((prev) => ({ ...prev, error: 'No device ID provided' }))
      return false
    }

    try {
      setState((prev) => ({ ...prev, isTransferring: true, error: null }))

      // Check if device exists
      const exists = await checkDeviceExists(deviceId)
      if (!exists) {
        // Try to refresh the player
        if (typeof window.refreshSpotifyPlayer === 'function') {
          await window.refreshSpotifyPlayer()
          await new Promise((resolve) => setTimeout(resolve, 2000))
          const stillExists = await checkDeviceExists(deviceId)
          if (!stillExists) {
            throw new Error('Device not found after refresh')
          }
        } else {
          throw new Error('Device not found')
        }
      }

      // Verify device transfer
      const isActive = await verifyDeviceTransfer(deviceId)
      if (!isActive) {
        const transferSuccessful = await transferPlaybackToDevice(deviceId)
        if (!transferSuccessful) {
          throw new Error('Failed to transfer playback to device')
        }
      }

      // Get current playback state
      const playbackState = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET'
      })

      if (!playbackState?.device) {
        throw new Error('No device information available')
      }

      setState({
        isReady: true,
        isTransferring: false,
        error: null
      })

      return true
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      setState({
        isReady: false,
        isTransferring: false,
        error: errorMessage
      })
      return false
    }
  }, [deviceId])

  const reset = useCallback(() => {
    setState({
      isReady: false,
      isTransferring: false,
      error: null
    })
  }, [])

  return {
    state,
    checkDevice,
    reset
  }
}
