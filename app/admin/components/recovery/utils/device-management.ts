import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'
import { DeviceVerificationState } from '@/shared/types/recovery'
import { VERIFICATION_TIMEOUT } from '@/shared/constants/recovery'

const deviceVerificationState: DeviceVerificationState = {
  isVerifying: false,
  lastVerification: 0,
  verificationLock: false
}

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

export async function verifyDeviceTransfer(
  deviceId: string,
  maxAttempts: number = 3,
  delayBetweenAttempts: number = 1000
): Promise<boolean> {
  // Check if we're already verifying
  if (deviceVerificationState.isVerifying) {
    console.log('[Device Verification] Already verifying, skipping')
    return false
  }

  // Check if we've verified recently
  const now = Date.now()
  if (now - deviceVerificationState.lastVerification < VERIFICATION_TIMEOUT) {
    console.log('[Device Verification] Verified recently, skipping')
    return true
  }

  // Try to acquire lock
  const hasLock = acquireVerificationLock()
  if (!hasLock) {
    console.log('[Device Verification] Could not acquire lock, skipping')
    return false
  }

  try {
    deviceVerificationState.isVerifying = true

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const state = await sendApiRequest<SpotifyPlaybackState>({
          path: 'me/player',
          method: 'GET'
        })

        if (state?.device?.id === deviceId && state.device.is_active) {
          deviceVerificationState.lastVerification = Date.now()
          return true
        }

        if (attempt < maxAttempts - 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, delayBetweenAttempts)
          )
        }
      } catch (error) {
        console.error(
          `[Device Verification] Attempt ${attempt + 1} failed:`,
          error
        )
        if (attempt < maxAttempts - 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, delayBetweenAttempts)
          )
        }
      }
    }
    return false
  } finally {
    deviceVerificationState.isVerifying = false
    releaseVerificationLock()
  }
}

export async function transferPlaybackToDevice(
  deviceId: string,
  maxAttempts: number = 3,
  delayBetweenAttempts: number = 1000
): Promise<boolean> {
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

        if (
          currentState?.device?.id === deviceId &&
          currentState.device.is_active
        ) {
          console.log('[Device Transfer] Device already active')
          return true
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
        await new Promise((resolve) =>
          setTimeout(resolve, delayBetweenAttempts)
        )

        // Verify transfer
        const isSuccessful = await verifyDeviceTransfer(deviceId)
        if (isSuccessful) {
          console.log('[Device Transfer] Transfer successful')
          return true
        }

        if (attempt < maxAttempts - 1) {
          console.log(
            `[Device Transfer] Attempt ${attempt + 1} failed, retrying...`
          )
          await new Promise((resolve) =>
            setTimeout(resolve, delayBetweenAttempts)
          )
        }
      } catch (error) {
        console.error(`[Device Transfer] Attempt ${attempt + 1} failed:`, error)
        if (attempt < maxAttempts - 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, delayBetweenAttempts)
          )
        }
      }
    }
    return false
  } finally {
    releaseVerificationLock()
  }
}
