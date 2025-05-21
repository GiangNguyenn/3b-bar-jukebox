import { sendApiRequest } from '@/shared/api'
import { RecoveryState, RecoveryStatus } from '@/shared/types/recovery'
import { RECOVERY_STEPS } from '@/shared/constants/recovery'
import { SpotifyPlaybackState } from '@/shared/types'

export function createRecoveryState(): RecoveryState {
  return {
    lastSuccessfulPlayback: {
      trackUri: null,
      position: 0,
      timestamp: 0
    },
    consecutiveFailures: 0,
    lastErrorType: null,
    lastRecoveryAttempt: 0
  }
}

export function createRecoveryStatus(): RecoveryStatus {
  return {
    isRecovering: false,
    message: '',
    progress: 0,
    currentStep: 0,
    totalSteps: RECOVERY_STEPS.length
  }
}

export function updateRecoveryState(
  currentState: RecoveryState,
  updates: Partial<RecoveryState>
): RecoveryState {
  return {
    ...currentState,
    ...updates,
    lastSuccessfulPlayback: {
      ...currentState.lastSuccessfulPlayback,
      ...(updates.lastSuccessfulPlayback ?? {})
    }
  }
}

export function cleanupRecoveryResources(): void {
  if (typeof window.spotifyPlayerInstance?.disconnect === 'function') {
    try {
      window.spotifyPlayerInstance.disconnect()
    } catch (error) {
      console.error('[Cleanup] Failed to disconnect player:', error)
    }
  }
}

export async function cleanupPlaybackState(): Promise<void> {
  try {
    // Only pause if we're actually playing
    const state = await sendApiRequest<SpotifyPlaybackState>({
      path: 'me/player',
      method: 'GET'
    })

    if (state?.is_playing) {
      await sendApiRequest({
        path: 'me/player/pause',
        method: 'PUT'
      })
    }
  } catch (error) {
    console.error('[Cleanup] Failed to pause playback:', error)
  }
}
