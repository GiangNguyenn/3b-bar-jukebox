import { sendApiRequest } from '@/shared/api'
import {
  cleanupOtherDevices,
  validateDevice
} from '@/services/deviceManagement'
import * as Sentry from '@sentry/nextjs'
import { createModuleLogger } from '@/shared/utils/logger'

// Set up logger for this module
const logger = createModuleLogger('Recovery')

// Helper to wait for device to become active
async function waitForDeviceActive(
  deviceId: string,
  timeoutMs = 10000
): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const devices = await sendApiRequest<{
      devices: { id: string; is_active: boolean }[]
    }>({
      path: 'me/player/devices',
      method: 'GET'
    })
    if (devices.devices.some((d) => d.id === deviceId && d.is_active)) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

export async function recoverDevice(
  deviceId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Step 1: Get current devices
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
    await sendApiRequest({
      path: 'me/player',
      method: 'PUT',
      body: {
        device_ids: [deviceId],
        play: false
      }
    })

    // Step 4: Wait for device to become active
    const active = await waitForDeviceActive(deviceId)
    if (!active) {
      throw new Error('Device did not become active in time')
    }

    // Step 5: Clean up other devices
    const cleanupOk = await cleanupOtherDevices(deviceId)
    if (!cleanupOk) {
      logger('WARN', 'Some devices could not be cleaned up')
    }

    // Step 6: Verify device transfer
    const deviceValidation = await validateDevice(deviceId)
    const transferOk =
      deviceValidation.isValid && (deviceValidation.device?.isActive ?? false)
    if (!transferOk) {
      throw new Error('Device transfer verification failed')
    }

    // Log success
    Sentry.logger.warn('Recovery completed successfully', {
      deviceId,
      timestamp: new Date().toISOString()
    })

    return { success: true }
  } catch (error) {
    // Log error
    logger(
      'ERROR',
      `Recovery failed: ${JSON.stringify({ error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined })}`,
      undefined,
      error instanceof Error ? error : undefined
    )
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
