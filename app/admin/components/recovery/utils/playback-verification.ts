import { sendApiRequest } from '@/shared/api'
import { SpotifyPlaybackState } from '@/shared/types'
import { PlaybackVerificationResult } from '@/shared/types/recovery'
import { PLAYBACK_VERIFICATION_TIMEOUT, PLAYBACK_CHECK_INTERVAL } from '@/shared/constants/recovery'
import { validatePlaybackState, validateDeviceState } from './validation'

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

  // Validate initial state
  const stateValidation = validatePlaybackState(initialState)
  if (!stateValidation.isValid) {
    console.error('[Playback Verification] Invalid initial state:', stateValidation.errors)
    throw new Error(`Invalid playback state: ${stateValidation.errors.join(', ')}`)
  }

  // Validate device state
  const deviceValidation = validateDeviceState(currentDeviceId, initialState)
  if (!deviceValidation.isValid) {
    console.error('[Playback Verification] Invalid device state:', deviceValidation.errors)
    throw new Error(`Invalid device state: ${deviceValidation.errors.join(', ')}`)
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

  while (Date.now() - startTime < maxVerificationTime) {
    await new Promise(resolve => setTimeout(resolve, checkInterval))
    
    currentState = await sendApiRequest<SpotifyPlaybackState>({
      path: 'me/player',
      method: 'GET'
    })

    // Validate current state
    const currentStateValidation = validatePlaybackState(currentState)
    if (!currentStateValidation.isValid) {
      console.error('[Playback Verification] Invalid current state:', currentStateValidation.errors)
      throw new Error(`Invalid playback state: ${currentStateValidation.errors.join(', ')}`)
    }

    const currentProgress = currentState.progress_ms ?? 0
    
    if (currentProgress > lastProgress) {
      lastProgress = currentProgress
      progressStalled = false
    } else {
      const isNearEnd = currentState.item?.duration_ms && 
        (currentState.item.duration_ms - currentProgress) < 5000
      
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

    if (!progressStalled && currentState.device?.id === currentDeviceId) {
      break
    }
  }

  if (!currentState) {
    throw new Error('Failed to get playback state')
  }

  const verificationResult: PlaybackVerificationResult = {
    isSuccessful: !progressStalled && currentState.device?.id === currentDeviceId,
    reason: progressStalled ? 'Playback progress stalled' : 
           currentState.device?.id !== currentDeviceId ? 'Device mismatch' :
           'Playback resumed successfully',
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