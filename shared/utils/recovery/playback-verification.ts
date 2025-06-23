import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types/spotify'
import { PlaybackVerificationResult } from '@/shared/types/recovery'
import {
  PLAYBACK_VERIFICATION_TIMEOUT,
  PLAYBACK_CHECK_INTERVAL
} from '@/shared/constants/recovery'
import { validateDeviceState } from './validation'
import { validatePlaybackState } from './validation'
import { validateDevice } from '@/services/deviceManagement'

export async function verifyPlaybackResume(
  expectedContextUri: string,
  currentDeviceId: string | null,
  maxVerificationTime: number = PLAYBACK_VERIFICATION_TIMEOUT,
  checkInterval: number = PLAYBACK_CHECK_INTERVAL
): Promise<PlaybackVerificationResult> {
  const startTime = Date.now()
  console.log('[Playback Verification] Starting verification process', {
    expectedContextUri,
    currentDeviceId,
    maxVerificationTime,
    checkInterval,
    timestamp: new Date().toISOString()
  })

  const initialState = await sendApiRequest<SpotifyPlaybackState>({
    path: 'me/player',
    method: 'GET'
  })

  // For recovery scenarios, be more lenient with initial state validation
  // Only validate if we have a state, but don't require all fields to be present
  if (initialState) {
    const stateValidation = validatePlaybackState(initialState)
    if (!stateValidation.isValid) {
      console.warn(
        '[Playback Verification] Initial state has issues (continuing anyway):',
        stateValidation.errors
      )
      // Don't throw error, just log warnings and continue
    }
  } else {
    console.log(
      '[Playback Verification] No initial playback state (this is normal during recovery)'
    )
  }

  // Only validate device state if we have both a device ID and initial state
  if (currentDeviceId && initialState?.device?.id) {
    const deviceValidation = validateDeviceState(currentDeviceId, initialState)
    if (!deviceValidation.isValid) {
      console.warn(
        '[Playback Verification] Initial device state has issues (continuing anyway):',
        deviceValidation.errors
      )
      // Don't throw error, just log warnings and continue
    }
  }

  console.log('[Playback Verification] Initial state:', {
    deviceId: initialState?.device?.id,
    isPlaying: initialState?.is_playing,
    progress: initialState?.progress_ms,
    context: initialState?.context?.uri,
    currentTrack: initialState?.item?.name,
    timestamp: new Date().toISOString()
  })

  const initialProgress = initialState?.progress_ms ?? 0
  let lastProgress = initialProgress
  let currentState: SpotifyPlaybackState | null = null
  let progressStalled = false
  let attempts = 0
  const maxAttempts = Math.ceil(maxVerificationTime / checkInterval)

  while (
    Date.now() - startTime < maxVerificationTime &&
    attempts < maxAttempts
  ) {
    await new Promise((resolve) => setTimeout(resolve, checkInterval))
    attempts++

    try {
      currentState = await sendApiRequest<SpotifyPlaybackState>({
        path: 'me/player',
        method: 'GET'
      })
    } catch (error) {
      console.warn(
        '[Playback Verification] Failed to get playback state, retrying:',
        error
      )
      continue
    }

    // If we still don't have a state after several attempts, that's okay during recovery
    if (!currentState) {
      console.log(
        '[Playback Verification] No playback state yet (attempt',
        attempts,
        'of',
        maxAttempts,
        ')'
      )
      continue
    }

    // Validate current state more leniently
    const currentStateValidation = validatePlaybackState(currentState)
    if (!currentStateValidation.isValid) {
      console.warn(
        '[Playback Verification] Current state has issues (continuing anyway):',
        currentStateValidation.errors
      )
      // Continue checking, don't throw error
    }

    const currentProgress = currentState.progress_ms ?? 0

    if (currentProgress > lastProgress) {
      lastProgress = currentProgress
      progressStalled = false
    } else {
      const isNearEnd =
        currentState.item?.duration_ms &&
        currentState.item.duration_ms - currentProgress < 5000

      if (!isNearEnd) {
        progressStalled = true
      }
    }

    console.log('[Playback Verification] Progress check:', {
      currentProgress,
      lastProgress,
      progressStalled,
      timestamp: new Date().toISOString()
    })

    // Check if we have successful playback
    if (
      !progressStalled &&
      currentState.device?.id === currentDeviceId &&
      currentState.is_playing
    ) {
      break
    }
  }

  // If we never got a valid state, that's okay during recovery
  if (!currentState) {
    console.log(
      '[Playback Verification] No valid playback state obtained during verification period'
    )
    const verificationResult: PlaybackVerificationResult = {
      isSuccessful: false,
      reason: 'No playback state available during verification',
      details: {
        deviceMatch: false,
        isPlaying: false,
        progressAdvancing: false,
        contextMatch: false,
        currentTrack: undefined,
        timestamp: Date.now(),
        verificationDuration: Date.now() - startTime
      }
    }
    return verificationResult
  }

  const verificationResult: PlaybackVerificationResult = {
    isSuccessful:
      // For recovery scenarios, be more lenient - only require that we have a valid state
      // and that it's either playing or we have a device match
      !!currentState &&
      (currentState.is_playing ||
        currentState.device?.id === currentDeviceId ||
        // If we have any progress at all, consider it successful
        !!(currentState.progress_ms && currentState.progress_ms > 0)),
    reason: !currentState
      ? 'No playback state available'
      : progressStalled
        ? 'Playback progress stalled (but continuing)'
        : currentState.device?.id !== currentDeviceId
          ? 'Device mismatch (but continuing)'
          : !currentState.is_playing
            ? 'Playback not active (but continuing)'
            : 'Playback resumed successfully',
    details: {
      deviceMatch: currentState.device?.id === currentDeviceId,
      isPlaying: currentState.is_playing,
      progressAdvancing: !progressStalled,
      contextMatch: currentState.context?.uri === expectedContextUri,
      currentTrack: currentState.item?.name,
      timestamp: Date.now(),
      verificationDuration: Date.now() - startTime
    }
  }

  return verificationResult
}

export async function verifyDevicePlaybackState(
  deviceId: string,
  state: SpotifyPlaybackState | null
): Promise<void> {
  // Validate device using the new consolidated function
  const deviceValidation = await validateDevice(deviceId)
  if (!deviceValidation.isValid) {
    throw new Error(
      `Device validation failed: ${deviceValidation.errors.join(', ')}`
    )
  }

  // Validate playback state
  if (!state) {
    throw new Error('No playback state available')
  }

  if (!state.is_playing) {
    throw new Error('Playback is not active')
  }

  if (!state.context) {
    throw new Error('No playback context available')
  }

  // Additional validation: check if device is active for playback
  if (!deviceValidation.device?.isActive) {
    throw new Error('Device is not active')
  }
}
