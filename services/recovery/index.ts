import { sendApiRequest } from '@/shared/api'
import {
  cleanupOtherDevices,
  validateDevice
} from '@/services/deviceManagement'
import * as Sentry from '@sentry/nextjs'

// Helper to wait for device to become active
async function waitForDeviceActive(
  deviceId: string,
  timeoutMs = 10000
): Promise<boolean> {
  console.log('[Recovery] Waiting for device to become active:', {
    deviceId,
    timeoutMs
  })
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const devices = await sendApiRequest<{
      devices: { id: string; is_active: boolean }[]
    }>({
      path: 'me/player/devices',
      method: 'GET'
    })
    console.log('[Recovery] Checking device status:', {
      found: devices.devices.some((d) => d.id === deviceId),
      isActive: devices.devices.some((d) => d.id === deviceId && d.is_active),
      deviceCount: devices.devices.length
    })
    if (devices.devices.some((d) => d.id === deviceId && d.is_active)) {
      console.log('[Recovery] Device became active successfully')
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  console.log('[Recovery] Device activation timed out')
  return false
}

export async function recoverDevice(
  deviceId: string
): Promise<{ success: boolean; error?: string }> {
  console.log('[Recovery] Starting recovery process')
  try {
    // Step 1: Get current devices
    console.log('[Recovery] Getting current devices')
    const devices = await sendApiRequest<{
      devices: { id: string; is_active: boolean }[]
    }>({
      path: 'me/player/devices',
      method: 'GET'
    })

    // Step 2: Find the Web Playback SDK device
    const webPlaybackDevice = devices.devices.find((d) => d.id === deviceId)
    if (!webPlaybackDevice) {
      throw new Error('Web Playback SDK device not found')
    }

    // Step 3: Transfer playback to the device
    console.log('[Recovery] Transferring playback to device:', { deviceId })
    await sendApiRequest({
      path: 'me/player',
      method: 'PUT',
      body: {
        device_ids: [deviceId],
        play: false
      }
    })

    // Step 4: Wait for device to become active
    console.log('[Recovery] Waiting for device to become active')
    const active = await waitForDeviceActive(deviceId)
    if (!active) {
      throw new Error('Device did not become active in time')
    }

    // Step 5: Clean up other devices
    console.log('[Recovery] Cleaning up other devices')
    const cleanupOk = await cleanupOtherDevices(deviceId)
    if (!cleanupOk) {
      console.warn('[Recovery] Some devices could not be cleaned up')
    }

    // Step 6: Verify device transfer
    console.log('[Recovery] Verifying device transfer')
    const deviceValidation = await validateDevice(deviceId)
    const transferOk =
      deviceValidation.isValid && (deviceValidation.device?.isActive ?? false)
    if (!transferOk) {
      throw new Error('Device transfer verification failed')
    }

    // Log success
    console.log('[Recovery] Recovery completed successfully', {
      deviceId,
      timestamp: new Date().toISOString()
    })
    Sentry.logger.warn('Recovery completed successfully', {
      deviceId,
      timestamp: new Date().toISOString()
    })

    return { success: true }
  } catch (error) {
    // Log error
    console.error('[Recovery] Recovery failed:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })
    Sentry.logger.error('Recovery failed', {
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Recovery failed'
    }
  }
}
